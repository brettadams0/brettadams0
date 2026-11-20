# Flic 2 SDK talks to the button over reflection-free BLE code, but keep it whole:
# a stripped callback means a silent button.
-keep class io.flic.flic2libandroid.** { *; }
# Wire types are decoded by kotlinx.serialization (its own rules cover the
# generated serializers); keep field names so JSON keys still match.
-keepclassmembers class dev.switchboard.app.** { @kotlinx.serialization.SerialName <fields>; }
-keep,includedescriptorclasses class dev.switchboard.app.**$$serializer { *; }
-keepclassmembers class dev.switchboard.app.** { *** Companion; }
-keepclasseswithmembers class dev.switchboard.app.** { kotlinx.serialization.KSerializer serializer(...); }
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
