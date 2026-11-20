pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode = RepositoriesMode.FAIL_ON_PROJECT_REPOS
    repositories {
        google()
        mavenCentral()
        // Flic 2 SDK (hold-to-talk button) is only published on JitPack.
        maven("https://jitpack.io") { content { includeGroup("com.github.50ButtonsEach") } }
    }
}

rootProject.name = "switchboard-android"
include(":app")
