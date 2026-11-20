package dev.switchboard.app

/**
 * Turn a chat message into something worth hearing through an earbud. Pure
 * functions, so they're unit-tested on the JVM.
 */
object Speech {
    private val codeBlock = Regex("```[\\s\\S]*?```")
    private val inlineCode = Regex("`([^`]{1,40})`")
    private val longInlineCode = Regex("`[^`]{41,}`")
    private val url = Regex("https?://([^/\\s]+)\\S*")
    private val markdown = Regex("(\\*\\*|__|~~|^#{1,6}\\s+|^>\\s+)", RegexOption.MULTILINE)
    private val bullet = Regex("^\\s*([-*+]|\\d+\\.)\\s+", RegexOption.MULTILINE)
    private val path = Regex("(?<![\\w])(/[\\w.-]+){3,}")
    private val space = Regex("[ \\t]+")

    fun clean(text: String): String = text
        .replace(codeBlock, " (code on screen) ")
        .replace(longInlineCode, " (code on screen) ")
        .replace(inlineCode, "$1")
        .replace(url) { "a link to ${it.groupValues[1].removePrefix("www.")}" }
        .replace(path) { m -> "…" + m.value.substringAfterLast('/') }
        .replace(markdown, "")
        .replace(bullet, "")
        .replace(space, " ")
        .let(::joinLines)
        .let { if (it.length > MAX) it.take(MAX).substringBeforeLast(' ') + "… the rest is on screen." else it }

    /** Lines become sentences: a period where a line ended without punctuation. */
    private fun joinLines(text: String): String =
        text.lines().map { it.trim() }.filter { it.isNotEmpty() }.fold("") { acc, line ->
            when {
                acc.isEmpty() -> line
                acc.last() in ".!?:;,…)" -> "$acc $line"
                else -> "$acc. $line"
            }
        }

    /** What to say for a message, or null if it shouldn't be spoken. */
    fun utterance(m: Message, mode: String): String? {
        if (!m.toUser || m.fromUser || mode == "off") return null
        if (mode == "flagged" && !m.speak) return null
        val body = clean(m.body)
        if (body.isBlank()) return null
        return when {
            m.kind == "permission" -> "$body. Hold the button and say yes or no."
            m.from_kind == "session" -> "${m.from_name}: $body"
            else -> body
        }
    }

    /** "yes"/"no" etc. Same vocabulary the server treats as a verdict. */
    fun isVerdict(text: String) = VERDICT.matches(text.trim().lowercase())
    private val VERDICT = Regex("(yes|y|yep|yeah|allow|approve|approved|ok|okay|go ahead|no|n|nope|deny|denied|reject)[.!]?")

    private const val MAX = 700
}
