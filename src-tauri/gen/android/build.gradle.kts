buildscript {
    repositories {
        // dl.google.com is blocked on this network; use mirrors of Google
        // Maven instead. A chain of mirrors + mavenCentral provides fallback
        // so an intermittent 502 (or a gap) on one mirror can't fail the build.
        maven { url = uri("https://maven.aliyun.com/repository/google") }
        maven { url = uri("https://mirrors.cloud.tencent.com/nexus/repository/maven-public/") }
        mavenCentral()
        google()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.11.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.25")
    }
}

allprojects {
    repositories {
        // dl.google.com is blocked on this network; use mirrors of Google
        // Maven instead. A chain of mirrors + mavenCentral provides fallback
        // so an intermittent 502 (or a gap) on one mirror can't fail the build.
        maven { url = uri("https://maven.aliyun.com/repository/google") }
        maven { url = uri("https://mirrors.cloud.tencent.com/nexus/repository/maven-public/") }
        mavenCentral()
        google()
    }
}

tasks.register("clean").configure {
    delete("build")
}

