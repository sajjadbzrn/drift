plugins {
    `kotlin-dsl`
}

gradlePlugin {
    plugins {
        create("pluginsForCoolKids") {
            id = "rust"
            implementationClass = "RustPlugin"
        }
    }
}

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
    compileOnly(gradleApi())
    implementation("com.android.tools.build:gradle:8.11.0")
}

