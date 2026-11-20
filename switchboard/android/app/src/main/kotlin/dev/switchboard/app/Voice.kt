package dev.switchboard.app

import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale
import java.util.concurrent.atomic.AtomicInteger

/** Reads messages aloud, one after another, ducking whatever else is playing. */
class Speaker(private val ctx: Context, private val prefs: Prefs) : TextToSpeech.OnInitListener {
    private val tts = TextToSpeech(ctx, this)
    private val audio = ctx.getSystemService(AudioManager::class.java)
    private val focus = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(ATTRS).build()
    private var ready = false
    private val pending = ArrayDeque<String>()
    private val outstanding = AtomicInteger(0)
    var last: String? = null
        private set

    override fun onInit(status: Int) {
        if (status != TextToSpeech.SUCCESS) return
        tts.language = Locale.getDefault()
        tts.setAudioAttributes(ATTRS)
        tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
            override fun onStart(id: String?) {}
            override fun onDone(id: String?) = finished()
            @Deprecated("Deprecated in Java")
            override fun onError(id: String?) = finished()
            override fun onStop(id: String?, interrupted: Boolean) = finished()
        })
        ready = true
        while (pending.isNotEmpty()) say(pending.removeFirst())
    }

    private fun finished() {
        if (outstanding.decrementAndGet() <= 0) {
            outstanding.set(0)
            audio.abandonAudioFocusRequest(focus)
        }
    }

    val speaking get() = ready && tts.isSpeaking

    fun say(text: String, remember: Boolean = true) {
        if (remember) last = text
        if (!ready) {
            pending.addLast(text)
            return
        }
        if (outstanding.getAndIncrement() == 0) audio.requestAudioFocus(focus)
        tts.setSpeechRate(prefs.speechRate)
        tts.speak(text, TextToSpeech.QUEUE_ADD, Bundle(), "sb-${System.nanoTime()}")
    }

    fun repeatLast() = last?.let { say(it, remember = false) }

    fun stop() {
        pending.clear()
        if (ready) tts.stop()
        outstanding.set(0)
        audio.abandonAudioFocusRequest(focus)
    }

    fun shutdown() = tts.shutdown()

    companion object {
        val ATTRS: AudioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
    }
}

/**
 * Push-to-talk. [start] when the button goes down, [finish] when it comes up;
 * the transcript is handed to [onText]. While the button is held, recognition
 * restarts after pauses so a long thought isn't cut off mid-sentence.
 * Must be used from the main thread.
 */
class Talk(private val ctx: Context, private val onText: (String) -> Unit, private val onState: (Boolean) -> Unit) {
    private val main = Handler(Looper.getMainLooper())
    private val tones = runCatching { ToneGenerator(AudioManager.STREAM_MUSIC, 70) }.getOrNull()
    private var rec: SpeechRecognizer? = null
    private val heard = StringBuilder()
    private var partial = ""
    private var holding = false
    private var active = false
    private val giveUp = Runnable { deliver() }

    val listening get() = active

    fun toggle() = if (active) finish() else start()

    fun start() {
        if (active) return
        if (!SpeechRecognizer.isRecognitionAvailable(ctx)) {
            error("Speech recognition isn't available on this phone.")
            return
        }
        heard.clear()
        partial = ""
        holding = true
        active = true
        onState(true)
        tones?.startTone(ToneGenerator.TONE_PROP_BEEP, 120)
        main.postDelayed({ if (holding) listen() }, 150) // let the beep finish before the mic opens
    }

    /** Button released: stop listening and send what was heard. */
    fun finish() {
        if (!active) return
        holding = false
        rec?.stopListening()
        main.postDelayed(giveUp, 2500) // final result normally lands well before this
    }

    /** Throw away what was heard (e.g. a tap rather than a hold). */
    fun cancel() {
        holding = false
        active = false
        main.removeCallbacks(giveUp)
        rec?.cancel()
        onState(false)
    }

    private fun listen() {
        val r = rec ?: SpeechRecognizer.createSpeechRecognizer(ctx).also { rec = it }
        r.setRecognitionListener(object : RecognitionListener {
            override fun onResults(results: Bundle) {
                results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let { append(it) }
                partial = ""
                if (holding) listen() else deliver()
            }
            override fun onPartialResults(p: Bundle) {
                partial = p.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
            }
            override fun onError(code: Int) {
                Log.d("Talk", "recognizer error $code")
                if (holding && (code == SpeechRecognizer.ERROR_NO_MATCH || code == SpeechRecognizer.ERROR_SPEECH_TIMEOUT)) {
                    listen()
                } else if (!holding || code != SpeechRecognizer.ERROR_RECOGNIZER_BUSY) {
                    if (code == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) error("Microphone permission is off for Switchboard.")
                    deliver()
                }
            }
            override fun onReadyForSpeech(params: Bundle?) {}
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() {}
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        r.startListening(Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 4000L)
        })
    }

    private fun append(text: String) {
        if (text.isBlank()) return
        if (heard.isNotEmpty()) heard.append(' ')
        heard.append(text.trim())
    }

    private fun deliver() {
        if (!active) return
        main.removeCallbacks(giveUp)
        if (partial.isNotBlank()) append(partial)
        partial = ""
        active = false
        holding = false
        onState(false)
        val text = heard.toString().trim()
        if (text.isEmpty()) {
            tones?.startTone(ToneGenerator.TONE_PROP_NACK, 200)
            return
        }
        tones?.startTone(ToneGenerator.TONE_PROP_ACK, 150)
        onText(text)
    }

    private var onError: (String) -> Unit = {}
    fun onError(handler: (String) -> Unit) { onError = handler }
    private fun error(msg: String) {
        tones?.startTone(ToneGenerator.TONE_PROP_NACK, 200)
        active = false
        holding = false
        onState(false)
        onError(msg)
    }

    fun shutdown() {
        rec?.destroy()
        rec = null
        tones?.release()
    }
}
