plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "it.agpress.aypi.calendar"
    compileSdk = 36

    defaultConfig {
        applicationId = "it.agpress.aypi.calendar"
        minSdk = 26
        targetSdk = 36
        versionCode = 11
        versionName = "0.5.1"

        buildConfigField(
            "String",
            "AYPI_API_BASE_URL",
            "\"https://dl360.tail9923fa.ts.net\"",
        )
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
    }
}

val buildFornoAssets by tasks.registering(Exec::class) {
    val workspace = rootProject.projectDir.parentFile.parentFile
    workingDir(workspace)
    commandLine("node", "tools/build-forno-mobile.cjs")
    inputs.dir(workspace.resolve("src/renderer/scripts/forno"))
    inputs.file(workspace.resolve("src/renderer/scripts/forno-scripts.ts"))
    inputs.file(workspace.resolve("src/main/modules/forno/preferences.ts"))
    inputs.dir(workspace.resolve("mobile/forno"))
    inputs.file(workspace.resolve("tools/build-forno-mobile.cjs"))
    inputs.file(workspace.resolve("package-lock.json"))
    inputs.file(workspace.resolve("src/renderer/pages/forno.html"))
    inputs.dir(workspace.resolve("src/renderer/styles"))
    inputs.file(workspace.resolve("src/renderer/scripts/utility-layout-bootstrap.js"))
    outputs.dir(layout.buildDirectory.dir("generated/fornoAssets"))
}
android.sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/fornoAssets").get().asFile)
tasks.named("preBuild").configure { dependsOn(buildFornoAssets) }

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.03.00")
    implementation(composeBom)

    implementation("androidx.activity:activity-compose:1.12.1")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material:material-icons-extended")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.9.4")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    debugImplementation("androidx.compose.ui:ui-tooling")
    debugImplementation("androidx.compose.ui:ui-test-manifest")

    testImplementation("junit:junit:4.13.2")
}
