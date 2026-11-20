package dev.switchboard.app

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SpeechTest {
    private fun msg(body: String, from: String = "main", fromKind: String = "session", toKind: String = "user", speak: Boolean = true, kind: String = "chat") =
        Message(1, "2026-11-20T00:00:00Z", kind, fromKind, from, toKind, "you", body, speak)

    @Test fun `code blocks are not read out`() {
        val s = Speech.clean("Fixed it:\n```kotlin\nval x = 1\n```\nAll tests pass.")
        assertFalse(s.contains("val x"))
        assertTrue(s.contains("code on screen"))
        assertTrue(s.endsWith("All tests pass."))
    }

    @Test fun `urls become their host`() =
        assertEquals("See a link to github.com", Speech.clean("See https://www.github.com/a/b/pull/12?x=1"))

    @Test fun `markdown and bullets are stripped`() =
        assertEquals("Done. First thing. Second thing", Speech.clean("**Done.**\n- First thing\n- Second thing"))

    @Test fun `long paths say only the file`() =
        assertEquals("Edited …server.ts", Speech.clean("Edited /home/me/proj/src/server.ts"))

    @Test fun `long replies are cut with a pointer to the screen`() {
        val s = Speech.clean("word ".repeat(400))
        assertTrue(s.length < 760)
        assertTrue(s.endsWith("the rest is on screen."))
    }

    @Test fun `who speaks is announced, your own messages are not read back`() {
        assertEquals("main: Hello", Speech.utterance(msg("Hello"), "flagged"))
        assertNull(Speech.utterance(msg("hi", from = "you", fromKind = "user", toKind = "session"), "all"))
        assertNull(Speech.utterance(msg("peer chat", toKind = "session"), "all"))
    }

    @Test fun `speak modes`() {
        assertNull(Speech.utterance(msg("quiet", speak = false), "flagged"))
        assertEquals("main: quiet", Speech.utterance(msg("quiet", speak = false), "all"))
        assertNull(Speech.utterance(msg("anything"), "off"))
    }

    @Test fun `permission prompts tell you how to answer`() {
        val u = Speech.utterance(msg("main wants to use Bash: run tests", kind = "permission"), "flagged")!!
        assertTrue(u.endsWith("say yes or no."))
    }

    @Test fun `verdict vocabulary`() {
        assertTrue(Speech.isVerdict("Yes."))
        assertTrue(Speech.isVerdict("go ahead"))
        assertFalse(Speech.isVerdict("yes but first run the linter"))
    }
}
