@echo off
chcp 936 >nul 2>&1
setlocal EnableExtensions
REM ============================================================================
REM  build.bat  ——  网页项目 一键打包为 Android APK
REM
REM  原理：生成一个极简的原生 Android 壳工程（单个 Activity + 全屏 WebView），
REM        把网页文件放进 assets，由 Gradle + Android Gradle Plugin 编译成 APK。
REM        壳工程不依赖 Cordova / Capacitor / Node，只需要 JDK + Android SDK。
REM
REM  用法：
REM    build.bat              构建 Debug APK（自动用 debug 签名，装了就能跑）
REM    build.bat release      构建 Release APK（自动创建正式签名 keystore）
REM    build.bat install      构建 Debug 并安装到已连接的设备/模拟器
REM    build.bat check        只做环境体检，不构建
REM    build.bat clean        删除生成的壳工程与产物
REM
REM  ============================ 重要 ============================
REM  本文件必须保存为 ANSI / GBK 编码（不是 UTF-8）。
REM  原因：cmd 按控制台代码页逐行读取 .bat，UTF-8 的中文会被 GBK 解析成乱码
REM        进而破坏语法（表现为一堆「不是内部或外部命令」）。
REM  而生成的工程文件全部是 ASCII，唯一含中文的 strings.xml 由 PowerShell
REM  单独以 UTF-8 无 BOM 写出（aapt2 强制要求资源文件为 UTF-8）。
REM  ==============================================================
REM ============================================================================

REM ---------------------------- 配置区（按需修改） ----------------------------
set "APP_NAME=地球Online"
set "PACKAGE_ID=com.earthonline.app"
set "VERSION_NAME=1.0"
set "VERSION_CODE=1"
set "MIN_SDK=24"

REM 网页入口。默认 index.html（现代 WebView 完全支持 ES6）。
REM 若要兼容很老的设备（Android 5/6），可改成 index_pakr.html（项目里的 ES5 单文件版）。
set "WEB_ENTRY=index.html"

REM 除 css / js / icons 之外还要一起打进 APK 的静态资源目录（空格分隔，可留空）
set "EXTRA_ASSET_DIRS="

REM 若存在 package.json，是否自动执行 npm install + npm run build（1=是 0=否）
set "AUTO_NPM_BUILD=1"

REM 是否允许在没有 Gradle 时联网下载（1=允许 0=禁止）
set "ALLOW_GRADLE_DOWNLOAD=1"

REM 正式签名配置（首次 release 构建时会自动生成 keystore）
set "KEYSTORE_FILE=%~dp0earth-online.keystore"
set "KEY_ALIAS=earthonline"
set "KEYSTORE_PASS=earthonline123"
set "KEY_PASS=earthonline123"

REM ---------------------------- 路径与常量 ----------------------------
set "PROJECT_DIR=%~dp0"
set "WRAPPER_DIR=%PROJECT_DIR%android-build"
set "CACHE_DIR=%WRAPPER_DIR%\.cache"
set "DIST_DIR=%PROJECT_DIR%dist"
set "ENTRY_URL=file:///android_asset/index.html"
set "GRADLE_DIST_BASE=https://services.gradle.org/distributions"

set "BUILD_TYPE=debug"
set "DO_INSTALL=0"
set "MODE=build"
set "KEYTOOL_EXE="

REM ---------------------------- 参数解析 ----------------------------
if /i "%~1"=="release" set "BUILD_TYPE=release"
if /i "%~1"=="install" (
    set "BUILD_TYPE=debug"
    set "DO_INSTALL=1"
)
if /i "%~1"=="check" set "MODE=check"
if /i "%~1"=="clean" set "MODE=clean"

call :printBanner

if "%MODE%"=="clean" goto :doClean

REM ============================================================================
echo.
echo ================ 第 1 步 / 共 6 步：检查 Java 环境 ================
echo.
call :checkJava
if errorlevel 1 goto :fail

echo.
echo ================ 第 2 步 / 共 6 步：检查 Android SDK ================
echo.
call :checkAndroidSdk
if errorlevel 1 goto :fail

echo.
echo ================ 第 3 步 / 共 6 步：选定工具链版本 ================
echo.
call :selectToolchain
if errorlevel 1 goto :fail

if "%MODE%"=="check" goto :reportCheck

echo.
echo ================ 第 4 步 / 共 6 步：准备网页产物 ================
echo.
call :prepareWeb
if errorlevel 1 goto :fail

echo.
echo ================ 第 5 步 / 共 6 步：生成 Android 壳工程 ================
echo.
call :generateProject
if errorlevel 1 goto :fail

echo.
echo ================ 第 6 步 / 共 6 步：编译 APK ================
echo.
call :ensureGradle
if errorlevel 1 goto :fail
call :buildApk
if errorlevel 1 goto :fail
call :collectOutput
if errorlevel 1 goto :fail

goto :done

REM ============================================================================
REM                              子过程
REM ============================================================================

:printBanner
echo.
echo  ------------------------------------------------------------
echo   网页项目 ^-^> Android APK 打包工具
echo   应用名称 : %APP_NAME%
echo   包名     : %PACKAGE_ID%
echo   版本     : %VERSION_NAME% ^( code %VERSION_CODE% ^)
echo  ------------------------------------------------------------
exit /b 0

REM ----------------------------------------------------------------------------
:checkJava
set "JAVA_EXE="
if defined JAVA_HOME (
    if exist "%JAVA_HOME%\bin\java.exe" set "JAVA_EXE=%JAVA_HOME%\bin\java.exe"
)
if not defined JAVA_EXE (
    for /f "delims=" %%J in ('where java 2^>nul') do (
        set "JAVA_EXE=%%J"
        goto :javaLocated
    )
)
:javaLocated
if not defined JAVA_EXE (
    echo   [错误] 找不到 java。
    echo         请安装 JDK 17 或更高版本：https://adoptium.net/
    echo         安装后把 JAVA_HOME 指向 JDK 目录，并把 %%JAVA_HOME%%\bin 加入 PATH。
    exit /b 1
)
echo   找到 java : %JAVA_EXE%

REM 读取版本号。java -version 输出到 stderr，先落临时文件再读。
REM 刻意不用 for /f + 管道：JAVA_EXE 路径含空格时，cmd /c 会剥掉首尾引号，
REM 把命令行拆成碎片（表现为 'C:\Program' 不是内部或外部命令）。
set "JV_TMP=%TEMP%\earth_online_java_ver.txt"
"%JAVA_EXE%" -version 2>"%JV_TMP%"
set "JAVA_VER_LINE="
if exist "%JV_TMP%" set /p JAVA_VER_LINE=<"%JV_TMP%"
set "JAVA_VER_RAW="
if defined JAVA_VER_LINE (
    for /f "tokens=3" %%V in ("%JAVA_VER_LINE%") do set "JAVA_VER_RAW=%%~V"
)
del "%JV_TMP%" >nul 2>&1
:javaVerGot
)
:javaVerGot
if not defined JAVA_VER_RAW (
    echo   [错误] 无法解析 Java 版本。
    exit /b 1
)

REM 老版本形如 1.8.0_382（主版本是第 2 段），新版本形如 21.0.5（第 1 段）
set "JAVA_MAJOR="
for /f "delims=." %%A in ("%JAVA_VER_RAW%") do set "JAVA_MAJOR=%%A"
if "%JAVA_MAJOR%"=="1" (
    for /f "tokens=2 delims=." %%A in ("%JAVA_VER_RAW%") do set "JAVA_MAJOR=%%A"
)
echo   Java 版本 : %JAVA_VER_RAW% ^( 主版本 %JAVA_MAJOR% ^)

REM 补 JAVA_HOME：PATH 上的 java 可能是 javapath 软链，不能靠路径推导，用 JVM 自己报的 java.home
if defined JAVA_HOME goto :javaHomeDone
"%JAVA_EXE%" -XshowSettings:properties -version 2>"%JV_TMP%"
set "JAVA_HOME="
for /f "usebackq tokens=1,* delims==" %%A in (`findstr /c:"java.home" "%JV_TMP%"`) do (
    set "JAVA_HOME=%%B"
)
REM findstr 结果带一个前导空格。注意不能写成 %JAVA_HOME: =% —— 那会连
REM "Program Files" 里的空格一起删掉，只能切掉开头这一个。
if defined JAVA_HOME if "%JAVA_HOME:~0,1%"==" " set "JAVA_HOME=%JAVA_HOME:~1%"
del "%JV_TMP%" >nul 2>&1
:javaHomeDone
if defined JAVA_HOME echo   JAVA_HOME : %JAVA_HOME%

REM 必须是 JDK（要有 javac），纯 JRE 编不了
set "JAVAC_EXE=%JAVA_HOME%\bin\javac.exe"
if not exist "%JAVAC_EXE%" (
    for /f "delims=" %%C in ('where javac 2^>nul') do (
        set "JAVAC_EXE=%%C"
        goto :javacLocated
    )
)
:javacLocated
if not exist "%JAVAC_EXE%" (
    echo   [错误] 只找到 JRE，缺少 javac（编译器）。
    echo         Android 构建必须是 JDK。请安装 JDK 17+：https://adoptium.net/
    exit /b 1
)
echo   找到 javac: %JAVAC_EXE%
if not defined KEYTOOL_EXE if exist "%JAVA_HOME%\bin\keytool.exe" set "KEYTOOL_EXE=%JAVA_HOME%\bin\keytool.exe"
exit /b 0

REM ----------------------------------------------------------------------------
:checkAndroidSdk
set "ANDROID_SDK="
if defined ANDROID_HOME (
    if exist "%ANDROID_HOME%\platforms" set "ANDROID_SDK=%ANDROID_HOME%"
)
if not defined ANDROID_SDK (
    if defined ANDROID_SDK_ROOT (
        if exist "%ANDROID_SDK_ROOT%\platforms" set "ANDROID_SDK=%ANDROID_SDK_ROOT%"
    )
)
if not defined ANDROID_SDK if exist "%LOCALAPPDATA%\Android\Sdk\platforms" set "ANDROID_SDK=%LOCALAPPDATA%\Android\Sdk"
if not defined ANDROID_SDK if exist "%USERPROFILE%\AppData\Local\Android\Sdk\platforms" set "ANDROID_SDK=%USERPROFILE%\AppData\Local\Android\Sdk"
if not defined ANDROID_SDK if exist "C:\Android\Sdk\platforms" set "ANDROID_SDK=C:\Android\Sdk"
if not defined ANDROID_SDK if exist "D:\Android\Sdk\platforms" set "ANDROID_SDK=D:\Android\Sdk"

if not defined ANDROID_SDK (
    echo   [错误] 找不到 Android SDK。
    echo         推荐做法：安装 Android Studio，它会自动把 SDK 装到
    echo           %%LOCALAPPDATA%%\Android\Sdk
    echo         也可以只装命令行工具后设置环境变量：
    echo           set ANDROID_HOME=C:\Users\你的用户名\AppData\Local\Android\Sdk
    exit /b 1
)
echo   Android SDK : %ANDROID_SDK%

REM 取已安装的 build-tools 里版本最高的一个
set "BT_VERSION="
REM 用 dir /o-n（名称降序）取最高版本，不调用 sort：
REM Git Bash / MSYS 的 PATH 里 Unix sort 会抢在 Windows sort.exe 之前，
REM 它把 /r 当文件名，直接报 cannot read: /r，导致误判"没有 build-tools"。
REM dir 是 cmd 内建命令，不存在这个冲突。
for /f "delims=" %%D in ('dir /b /ad /o-n "%ANDROID_SDK%\build-tools" 2^>nul') do (
    set "BT_VERSION=%%D"
    goto :btFound
)
:btFound
if not defined BT_VERSION (
    echo   [错误] SDK 里没有 build-tools。
    echo         请在 Android Studio ^-^> SDK Manager ^-^> SDK Tools 里勾选
    echo         "Android SDK Build-Tools"，或执行：
    echo           sdkmanager "build-tools;34.0.0"
    exit /b 1
)
echo   Build Tools : %BT_VERSION%

if exist "%ANDROID_SDK%\platform-tools\adb.exe" (
    echo   adb        : 已就绪
) else (
    echo   [警告] 未找到 platform-tools\adb.exe，将无法自动安装 APK 到设备。
)
exit /b 0

REM ----------------------------------------------------------------------------
:selectToolchain
REM AGP / Gradle / JDK 三者必须版本匹配，错配是最常见的构建失败原因。
REM 这里按检测到的 JDK 主版本自动选一套经过验证的组合。
if %JAVA_MAJOR% GEQ 21 (
    set "AGP_VERSION=8.3.2"
    set "GRADLE_VERSION=8.7"
    set "COMPILE_SDK=34"
    set "JAVA_COMPAT=17"
) else if %JAVA_MAJOR% GEQ 17 (
    set "AGP_VERSION=8.1.4"
    set "GRADLE_VERSION=8.2"
    set "COMPILE_SDK=34"
    set "JAVA_COMPAT=17"
) else if %JAVA_MAJOR% GEQ 11 (
    set "AGP_VERSION=7.4.2"
    set "GRADLE_VERSION=7.5"
    set "COMPILE_SDK=33"
    set "JAVA_COMPAT=11"
) else (
    echo   [错误] JDK 版本过低（%JAVA_MAJOR%）。Android Gradle Plugin 至少需要 JDK 11，
    echo         建议直接用 JDK 17 或 21：https://adoptium.net/
    exit /b 1
)
set "TARGET_SDK=%COMPILE_SDK%"

echo   工具链组合 : JDK %JAVA_MAJOR% ^+ AGP %AGP_VERSION% ^+ Gradle %GRADLE_VERSION%
echo   编译/目标   : android-%COMPILE_SDK%   最低支持 API %MIN_SDK%

if not exist "%ANDROID_SDK%\platforms\android-%COMPILE_SDK%" (
    echo   [错误] SDK 未安装 android-%COMPILE_SDK% 平台。
    echo         请安装：
    echo           sdkmanager "platforms;android-%COMPILE_SDK%"
    echo         或在 Android Studio ^-^> SDK Manager ^-^> SDK Platforms 里勾选对应版本。
    exit /b 1
)
echo   平台已安装 : %ANDROID_SDK%\platforms\android-%COMPILE_SDK%
exit /b 0

REM ----------------------------------------------------------------------------
:reportCheck
echo.
echo ================ 环境体检结果：通过 ================
echo   Java        : %JAVA_MAJOR% ^( %JAVA_EXE% ^)
echo   JAVA_HOME   : %JAVA_HOME%
echo   Android SDK : %ANDROID_SDK%
echo   Build Tools : %BT_VERSION%
echo   Gradle      : %GRADLE_VERSION% ^( AGP %AGP_VERSION% ^)
echo   编译 SDK     : android-%COMPILE_SDK%
echo   网页入口     : %WEB_ENTRY%
echo.
echo   就绪，可以运行 build.bat 开始打包。
echo   ^( 注意：首次构建需要联网下载 Gradle 与 AGP 依赖 ^)
goto :eof

REM ----------------------------------------------------------------------------
:prepareWeb
REM 若项目是工程化的（有 package.json），先跑 npm build
if "%AUTO_NPM_BUILD%"=="1" if exist "%PROJECT_DIR%package.json" (
    where npm >nul 2>&1
    if errorlevel 1 (
        echo   [警告] 检测到 package.json 但没有 npm，跳过前端构建，直接用现有文件。
    ) else (
        echo   执行前端构建（npm install ^+ npm run build）...
        pushd "%PROJECT_DIR%"
        if not exist "%PROJECT_DIR%node_modules" call npm install
        call npm run build
        popd
        if errorlevel 1 (
            echo   [错误] npm run build 失败。
            exit /b 1
        )
    )
)

REM 定位网页根目录：优先常见的前端产物目录，都没有就用当前目录
set "WEB_DIR="
if exist "%PROJECT_DIR%dist\index.html" set "WEB_DIR=%PROJECT_DIR%dist"
if not defined WEB_DIR if exist "%PROJECT_DIR%build\index.html" set "WEB_DIR=%PROJECT_DIR%build"
if not defined WEB_DIR if exist "%PROJECT_DIR%out\index.html" set "WEB_DIR=%PROJECT_DIR%out"
if not defined WEB_DIR if exist "%PROJECT_DIR%%WEB_ENTRY%" set "WEB_DIR=%PROJECT_DIR%"
if not defined WEB_DIR (
    echo   [错误] 找不到网页入口 %WEB_ENTRY%。
    echo         请确认当前目录是网页项目根目录，或修改脚本顶部的 WEB_ENTRY。
    exit /b 1
)
echo   网页根目录 : %WEB_DIR%
echo   网页入口   : %WEB_ENTRY%
exit /b 0

REM ----------------------------------------------------------------------------
:generateProject
set "PRJ=%WRAPPER_DIR%"
set "ASSETS=%PRJ%\app\src\main\assets"
set "PKG_PATH=%PACKAGE_ID:.=\%"
set "JAVA_SRC=%PRJ%\app\src\main\java\%PKG_PATH%"

echo   壳工程目录 : %PRJ%

if not exist "%PRJ%\app\src\main" mkdir "%PRJ%\app\src\main"
if not exist "%JAVA_SRC%" mkdir "%JAVA_SRC%"
if not exist "%PRJ%\app\src\main\res\values" mkdir "%PRJ%\app\src\main\res\values"
if not exist "%PRJ%\app\src\main\res\values-v23" mkdir "%PRJ%\app\src\main\res\values-v23"
if not exist "%PRJ%\app\src\main\res\xml" mkdir "%PRJ%\app\src\main\res\xml"

REM ---- local.properties：路径必须写成正斜杠，反斜杠在 properties 里是转义符 ----
set "SDK_FWD=%ANDROID_SDK:\=/%"
echo sdk.dir=%SDK_FWD%> "%PRJ%\local.properties"

echo   写入 settings.gradle ...
echo pluginManagement {> "%PRJ%\settings.gradle"
echo     repositories {>> "%PRJ%\settings.gradle"
echo         google^(^)>> "%PRJ%\settings.gradle"
echo         mavenCentral^(^)>> "%PRJ%\settings.gradle"
echo         gradlePluginPortal^(^)>> "%PRJ%\settings.gradle"
echo     }>> "%PRJ%\settings.gradle"
echo }>> "%PRJ%\settings.gradle"
echo dependencyResolutionManagement {>> "%PRJ%\settings.gradle"
echo     repositoriesMode.set^(RepositoriesMode.FAIL_ON_PROJECT_REPOS^)>> "%PRJ%\settings.gradle"
echo     repositories {>> "%PRJ%\settings.gradle"
echo         google^(^)>> "%PRJ%\settings.gradle"
echo         mavenCentral^(^)>> "%PRJ%\settings.gradle"
echo     }>> "%PRJ%\settings.gradle"
echo }>> "%PRJ%\settings.gradle"
echo rootProject.name = 'EarthOnline'>> "%PRJ%\settings.gradle"
echo include ':app'>> "%PRJ%\settings.gradle"

echo   写入 build.gradle（根）...
echo plugins {> "%PRJ%\build.gradle"
echo     id 'com.android.application' version '%AGP_VERSION%' apply false>> "%PRJ%\build.gradle"
echo }>> "%PRJ%\build.gradle"

echo   写入 gradle.properties ...
echo org.gradle.jvmargs=-Xmx2048m -Dfile.encoding=UTF-8> "%PRJ%\gradle.properties"
echo org.gradle.parallel=true>> "%PRJ%\gradle.properties"
echo org.gradle.caching=true>> "%PRJ%\gradle.properties"
echo android.useAndroidX=false>> "%PRJ%\gradle.properties"
echo android.nonTransitiveRClass=true>> "%PRJ%\gradle.properties"

echo   写入 app/build.gradle ...
echo plugins {> "%PRJ%\app\build.gradle"
echo     id 'com.android.application'>> "%PRJ%\app\build.gradle"
echo }>> "%PRJ%\app\build.gradle"
echo.>> "%PRJ%\app\build.gradle"
echo android {>> "%PRJ%\app\build.gradle"
echo     namespace '%PACKAGE_ID%'>> "%PRJ%\app\build.gradle"
echo     compileSdk %COMPILE_SDK% >> "%PRJ%\app\build.gradle"
echo.>> "%PRJ%\app\build.gradle"
echo     defaultConfig {>> "%PRJ%\app\build.gradle"
echo         applicationId '%PACKAGE_ID%'>> "%PRJ%\app\build.gradle"
echo         minSdk %MIN_SDK% >> "%PRJ%\app\build.gradle"
echo         targetSdk %TARGET_SDK% >> "%PRJ%\app\build.gradle"
echo         versionCode %VERSION_CODE% >> "%PRJ%\app\build.gradle"
echo         versionName '%VERSION_NAME%'>> "%PRJ%\app\build.gradle"
echo     }>> "%PRJ%\app\build.gradle"
echo.>> "%PRJ%\app\build.gradle"
echo     compileOptions {>> "%PRJ%\app\build.gradle"
echo         sourceCompatibility JavaVersion.VERSION_%JAVA_COMPAT%>> "%PRJ%\app\build.gradle"
echo         targetCompatibility JavaVersion.VERSION_%JAVA_COMPAT%>> "%PRJ%\app\build.gradle"
echo     }>> "%PRJ%\app\build.gradle"
echo.>> "%PRJ%\app\build.gradle"
echo     // Signing values come from keystore.properties (generated by build.bat).>> "%PRJ%\app\build.gradle"
echo     // We avoid -P command line args because cmd passes quotes through to the>> "%PRJ%\app\build.gradle"
echo     // JVM, which breaks any project path that contains spaces.>> "%PRJ%\app\build.gradle"
echo     signingConfigs {>> "%PRJ%\app\build.gradle"
echo         release {>> "%PRJ%\app\build.gradle"
echo             def ksProps = new Properties^(^)>> "%PRJ%\app\build.gradle"
echo             def ksFile = rootProject.file^('keystore.properties'^)>> "%PRJ%\app\build.gradle"
echo             if ^(ksFile.exists^(^)^) {>> "%PRJ%\app\build.gradle"
echo                 ksProps.load^(new FileInputStream^(ksFile^)^)>> "%PRJ%\app\build.gradle"
echo             }>> "%PRJ%\app\build.gradle"
echo             storeFile file^(ksProps['storeFile'] ?: 'default.keystore'^)>> "%PRJ%\app\build.gradle"
echo             storePassword ksProps['storePassword'] ?: 'placeholder'>> "%PRJ%\app\build.gradle"
echo             keyAlias ksProps['keyAlias'] ?: 'placeholder'>> "%PRJ%\app\build.gradle"
echo             keyPassword ksProps['keyPassword'] ?: 'placeholder'>> "%PRJ%\app\build.gradle"
echo         }>> "%PRJ%\app\build.gradle"
echo     }>> "%PRJ%\app\build.gradle"
echo.>> "%PRJ%\app\build.gradle"
echo     buildTypes {>> "%PRJ%\app\build.gradle"
echo         release {>> "%PRJ%\app\build.gradle"
echo             minifyEnabled false>> "%PRJ%\app\build.gradle"
echo             proguardFiles getDefaultProguardFile^('proguard-android-optimize.txt'^), 'proguard-rules.pro'>> "%PRJ%\app\build.gradle"
echo             signingConfig signingConfigs.release>> "%PRJ%\app\build.gradle"
echo         }>> "%PRJ%\app\build.gradle"
echo     }>> "%PRJ%\app\build.gradle"
echo }>> "%PRJ%\app\build.gradle"

echo   写入 proguard-rules.pro ...
echo -keepclassmembers class * {> "%PRJ%\app\proguard-rules.pro"
echo     @android.webkit.JavascriptInterface ^<methods^>;>> "%PRJ%\app\proguard-rules.pro"
echo }>> "%PRJ%\app\proguard-rules.pro"

echo   写入 AndroidManifest.xml ...
echo ^<?xml version="1.0" encoding="utf-8"?^>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo ^<manifest xmlns:android="http://schemas.android.com/apk/res/android"^>>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo.>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo     ^<uses-permission android:name="android.permission.INTERNET" /^>>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo     ^<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" /^>>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo     ^<!-- v15 footprint map geolocation --^>>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo     ^<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" /^>>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo     ^<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" /^>>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo.>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo     ^<application>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo         android:allowBackup="true">> "%PRJ%\app\src\main\AndroidManifest.xml"
echo         android:icon="@mipmap/ic_launcher">> "%PRJ%\app\src\main\AndroidManifest.xml"
echo         android:roundIcon="@mipmap/ic_launcher">> "%PRJ%\app\src\main\AndroidManifest.xml"
echo         android:label="@string/app_name">> "%PRJ%\app\src\main\AndroidManifest.xml"
echo         android:theme="@style/AppTheme">> "%PRJ%\app\src\main\AndroidManifest.xml"
echo         android:hardwareAccelerated="true">> "%PRJ%\app\src\main\AndroidManifest.xml"
echo         android:usesCleartextTraffic="true">> "%PRJ%\app\src\main\AndroidManifest.xml"
echo         android:networkSecurityConfig="@xml/network_security_config">> "%PRJ%\app\src\main\AndroidManifest.xml"
echo         android:supportsRtl="false"^>>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo.>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo         ^<activity>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo             android:name=".MainActivity">> "%PRJ%\app\src\main\AndroidManifest.xml"
echo             android:exported="true">> "%PRJ%\app\src\main\AndroidManifest.xml"
echo             android:launchMode="singleTop">> "%PRJ%\app\src\main\AndroidManifest.xml"
REM 这里的 | 不加 ^：它们处在双引号包裹的属性值内部，cmd 本来就不会当管道处理，
REM 加了 ^ 反而会被原样输出，让 aapt2 报非法字符。
echo             android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|uiMode">> "%PRJ%\app\src\main\AndroidManifest.xml"
echo             android:windowSoftInputMode="adjustResize"^>>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo             ^<intent-filter^>>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo                 ^<action android:name="android.intent.action.MAIN" /^>>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo                 ^<category android:name="android.intent.category.LAUNCHER" /^>>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo             ^</intent-filter^>>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo         ^</activity^>>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo     ^</application^>>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo.>> "%PRJ%\app\src\main\AndroidManifest.xml"
echo ^</manifest^>>> "%PRJ%\app\src\main\AndroidManifest.xml"

echo   写入 MainActivity.java ...
echo package %PACKAGE_ID%;> "%JAVA_SRC%\MainActivity.java"
echo.>> "%JAVA_SRC%\MainActivity.java"
echo import android.annotation.SuppressLint;>> "%JAVA_SRC%\MainActivity.java"
echo import android.app.Activity;>> "%JAVA_SRC%\MainActivity.java"
echo import android.os.Build;>> "%JAVA_SRC%\MainActivity.java"
echo import android.os.Bundle;>> "%JAVA_SRC%\MainActivity.java"
echo import android.webkit.WebChromeClient;>> "%JAVA_SRC%\MainActivity.java"
echo import android.webkit.WebResourceRequest;>> "%JAVA_SRC%\MainActivity.java"
echo import android.webkit.WebSettings;>> "%JAVA_SRC%\MainActivity.java"
echo import android.webkit.WebView;>> "%JAVA_SRC%\MainActivity.java"
echo import android.webkit.WebViewClient;>> "%JAVA_SRC%\MainActivity.java"
echo.>> "%JAVA_SRC%\MainActivity.java"
echo // Minimal WebView shell. No third-party dependencies: the whole app lives>> "%JAVA_SRC%\MainActivity.java"
echo // in assets and is served straight from the APK.>> "%JAVA_SRC%\MainActivity.java"
echo public class MainActivity extends Activity {>> "%JAVA_SRC%\MainActivity.java"
echo.>> "%JAVA_SRC%\MainActivity.java"
echo     private static final String ENTRY_URL = "%ENTRY_URL%";>> "%JAVA_SRC%\MainActivity.java"
echo.>> "%JAVA_SRC%\MainActivity.java"
echo     private WebView webView;>> "%JAVA_SRC%\MainActivity.java"
echo.>> "%JAVA_SRC%\MainActivity.java"
echo     @SuppressLint^("SetJavaScriptEnabled"^)>> "%JAVA_SRC%\MainActivity.java"
echo     @Override>> "%JAVA_SRC%\MainActivity.java"
echo     protected void onCreate^(Bundle savedInstanceState^) {>> "%JAVA_SRC%\MainActivity.java"
echo         super.onCreate^(savedInstanceState^);>> "%JAVA_SRC%\MainActivity.java"
echo.>> "%JAVA_SRC%\MainActivity.java"
echo         webView = new WebView^(this^);>> "%JAVA_SRC%\MainActivity.java"
echo         setContentView^(webView^);>> "%JAVA_SRC%\MainActivity.java"
echo.>> "%JAVA_SRC%\MainActivity.java"
echo         WebSettings s = webView.getSettings^(^);>> "%JAVA_SRC%\MainActivity.java"
echo         s.setJavaScriptEnabled^(true^);>> "%JAVA_SRC%\MainActivity.java"
echo         // localStorage holds every byte of user data in this app.>> "%JAVA_SRC%\MainActivity.java"
echo         // Without it the app resets to a blank slate on every restart.>> "%JAVA_SRC%\MainActivity.java"
echo         s.setDomStorageEnabled^(true^);>> "%JAVA_SRC%\MainActivity.java"
echo         s.setDatabaseEnabled^(true^);>> "%JAVA_SRC%\MainActivity.java"
echo         s.setAllowFileAccess^(true^);>> "%JAVA_SRC%\MainActivity.java"
echo         s.setAllowContentAccess^(true^);>> "%JAVA_SRC%\MainActivity.java"
echo         // Let a file:// page issue cross-origin requests (the AI assistant>> "%JAVA_SRC%\MainActivity.java"
echo         // calls an external chat API). Acceptable here because every page>> "%JAVA_SRC%\MainActivity.java"
echo         // comes from our own assets - we never load remote web content.>> "%JAVA_SRC%\MainActivity.java"
echo         s.setAllowFileAccessFromFileURLs^(true^);>> "%JAVA_SRC%\MainActivity.java"
echo         s.setAllowUniversalAccessFromFileURLs^(true^);>> "%JAVA_SRC%\MainActivity.java"
echo         s.setLoadWithOverviewMode^(true^);>> "%JAVA_SRC%\MainActivity.java"
echo         s.setUseWideViewPort^(true^);>> "%JAVA_SRC%\MainActivity.java"
echo         // The page already locks zoom via its viewport meta tag.>> "%JAVA_SRC%\MainActivity.java"
echo         s.setSupportZoom^(false^);>> "%JAVA_SRC%\MainActivity.java"
echo         s.setBuiltInZoomControls^(false^);>> "%JAVA_SRC%\MainActivity.java"
echo         s.setMediaPlaybackRequiresUserGesture^(false^);>> "%JAVA_SRC%\MainActivity.java"
echo         if ^(Build.VERSION.SDK_INT ^>= Build.VERSION_CODES.LOLLIPOP^) {>> "%JAVA_SRC%\MainActivity.java"
echo             s.setMixedContentMode^(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE^);>> "%JAVA_SRC%\MainActivity.java"
echo         }>> "%JAVA_SRC%\MainActivity.java"
echo.>> "%JAVA_SRC%\MainActivity.java"
echo         webView.setWebViewClient^(new WebViewClient^(^) {>> "%JAVA_SRC%\MainActivity.java"
echo             @Override>> "%JAVA_SRC%\MainActivity.java"
echo             public boolean shouldOverrideUrlLoading^(WebView view, WebResourceRequest request^) {>> "%JAVA_SRC%\MainActivity.java"
echo                 return false; // keep navigation inside the app>> "%JAVA_SRC%\MainActivity.java"
echo             }>> "%JAVA_SRC%\MainActivity.java"
echo         }^);>> "%JAVA_SRC%\MainActivity.java"
echo         webView.setWebChromeClient^(new WebChromeClient^(^)^);>> "%JAVA_SRC%\MainActivity.java"
echo.>> "%JAVA_SRC%\MainActivity.java"
echo         if ^(savedInstanceState != null^) {>> "%JAVA_SRC%\MainActivity.java"
echo             webView.restoreState^(savedInstanceState^);>> "%JAVA_SRC%\MainActivity.java"
echo         } else {>> "%JAVA_SRC%\MainActivity.java"
echo             webView.loadUrl^(ENTRY_URL^);>> "%JAVA_SRC%\MainActivity.java"
echo         }>> "%JAVA_SRC%\MainActivity.java"
echo     }>> "%JAVA_SRC%\MainActivity.java"
echo.>> "%JAVA_SRC%\MainActivity.java"
echo     @Override>> "%JAVA_SRC%\MainActivity.java"
echo     public void onBackPressed^(^) {>> "%JAVA_SRC%\MainActivity.java"
echo         if ^(webView != null ^&^& webView.canGoBack^(^)^) {>> "%JAVA_SRC%\MainActivity.java"
echo             webView.goBack^(^);>> "%JAVA_SRC%\MainActivity.java"
echo         } else {>> "%JAVA_SRC%\MainActivity.java"
echo             super.onBackPressed^(^);>> "%JAVA_SRC%\MainActivity.java"
echo         }>> "%JAVA_SRC%\MainActivity.java"
echo     }>> "%JAVA_SRC%\MainActivity.java"
echo.>> "%JAVA_SRC%\MainActivity.java"
echo     @Override>> "%JAVA_SRC%\MainActivity.java"
echo     protected void onSaveInstanceState^(Bundle outState^) {>> "%JAVA_SRC%\MainActivity.java"
echo         super.onSaveInstanceState^(outState^);>> "%JAVA_SRC%\MainActivity.java"
echo         if ^(webView != null^) webView.saveState^(outState^);>> "%JAVA_SRC%\MainActivity.java"
echo     }>> "%JAVA_SRC%\MainActivity.java"
echo.>> "%JAVA_SRC%\MainActivity.java"
echo     @Override>> "%JAVA_SRC%\MainActivity.java"
echo     protected void onPause^(^) {>> "%JAVA_SRC%\MainActivity.java"
echo         super.onPause^(^);>> "%JAVA_SRC%\MainActivity.java"
echo         if ^(webView != null^) webView.onPause^(^);>> "%JAVA_SRC%\MainActivity.java"
echo     }>> "%JAVA_SRC%\MainActivity.java"
echo.>> "%JAVA_SRC%\MainActivity.java"
echo     @Override>> "%JAVA_SRC%\MainActivity.java"
echo     protected void onResume^(^) {>> "%JAVA_SRC%\MainActivity.java"
echo         super.onResume^(^);>> "%JAVA_SRC%\MainActivity.java"
echo         if ^(webView != null^) webView.onResume^(^);>> "%JAVA_SRC%\MainActivity.java"
echo     }>> "%JAVA_SRC%\MainActivity.java"
echo }>> "%JAVA_SRC%\MainActivity.java"

echo   写入资源文件 ...
echo ^<?xml version="1.0" encoding="utf-8"?^>> "%PRJ%\app\src\main\res\values\themes.xml"
echo ^<resources^>>> "%PRJ%\app\src\main\res\values\themes.xml"
echo     ^<style name="AppTheme" parent="@android:style/Theme.Material.Light.NoActionBar"^>>> "%PRJ%\app\src\main\res\values\themes.xml"
echo         ^<item name="android:windowBackground"^>@android:color/white^</item^>>> "%PRJ%\app\src\main\res\values\themes.xml"
echo     ^</style^>>> "%PRJ%\app\src\main\res\values\themes.xml"
echo ^</resources^>>> "%PRJ%\app\src\main\res\values\themes.xml"

echo ^<?xml version="1.0" encoding="utf-8"?^>> "%PRJ%\app\src\main\res\values-v23\themes.xml"
echo ^<resources^>>> "%PRJ%\app\src\main\res\values-v23\themes.xml"
echo     ^<style name="AppTheme" parent="@android:style/Theme.Material.Light.NoActionBar"^>>> "%PRJ%\app\src\main\res\values-v23\themes.xml"
echo         ^<item name="android:windowBackground"^>@android:color/white^</item^>>> "%PRJ%\app\src\main\res\values-v23\themes.xml"
echo         ^<item name="android:windowLightStatusBar"^>true^</item^>>> "%PRJ%\app\src\main\res\values-v23\themes.xml"
echo     ^</style^>>> "%PRJ%\app\src\main\res\values-v23\themes.xml"
echo ^</resources^>>> "%PRJ%\app\src\main\res\values-v23\themes.xml"

echo ^<?xml version="1.0" encoding="utf-8"?^>> "%PRJ%\app\src\main\res\xml\network_security_config.xml"
echo ^<network-security-config^>>> "%PRJ%\app\src\main\res\xml\network_security_config.xml"
echo     ^<base-config cleartextTrafficPermitted="true"^>>> "%PRJ%\app\src\main\res\xml\network_security_config.xml"
echo         ^<trust-anchors^>>> "%PRJ%\app\src\main\res\xml\network_security_config.xml"
echo             ^<certificates src="system" /^>>> "%PRJ%\app\src\main\res\xml\network_security_config.xml"
echo         ^</trust-anchors^>>> "%PRJ%\app\src\main\res\xml\network_security_config.xml"
echo     ^</base-config^>>> "%PRJ%\app\src\main\res\xml\network_security_config.xml"
echo ^</network-security-config^>>> "%PRJ%\app\src\main\res\xml\network_security_config.xml"

REM strings.xml 是唯一含中文的生成文件。aapt2 强制要求资源为 UTF-8，
REM 而 echo 输出的是 GBK 字节，所以交给 PowerShell 以 UTF-8 无 BOM 写出。
echo   写入 strings.xml（UTF-8 无 BOM）...
set "PS_OUT=%PRJ%\app\src\main\res\values\strings.xml"
set "PS_APP_NAME=%APP_NAME%"
powershell -NoProfile -Command "$q=[char]34; $x='<?xml version='+$q+'1.0'+$q+' encoding='+$q+'utf-8'+$q+'?>'+[Environment]::NewLine+'<resources>'+[Environment]::NewLine+'    <string name='+$q+'app_name'+$q+'>'+$env:PS_APP_NAME+'</string>'+[Environment]::NewLine+'</resources>'; [System.IO.File]::WriteAllText($env:PS_OUT,$x,(New-Object System.Text.UTF8Encoding($false)))"
if errorlevel 1 (
    echo   [警告] PowerShell 写 strings.xml 失败，回退为 ASCII 名称。
    echo ^<?xml version="1.0" encoding="utf-8"?^>> "%PRJ%\app\src\main\res\values\strings.xml"
    echo ^<resources^>>> "%PRJ%\app\src\main\res\values\strings.xml"
    echo     ^<string name="app_name"^>EarthOnline^</string^>>> "%PRJ%\app\src\main\res\values\strings.xml"
    echo ^</resources^>>> "%PRJ%\app\src\main\res\values\strings.xml"
)

echo   复制网页资源到 assets ...
if exist "%ASSETS%" rmdir /s /q "%ASSETS%"
mkdir "%ASSETS%"

copy /y "%WEB_DIR%\%WEB_ENTRY%" "%ASSETS%\index.html" >nul
if errorlevel 1 (
    echo   [错误] 复制网页入口失败：%WEB_DIR%\%WEB_ENTRY%
    exit /b 1
)

for %%D in (css js icons %EXTRA_ASSET_DIRS%) do (
    if exist "%WEB_DIR%\%%D\" (
        xcopy /e /i /y /q "%WEB_DIR%\%%D" "%ASSETS%\%%D" >nul
        echo     + %%D\
    )
)
if exist "%WEB_DIR%\manifest.json" copy /y "%WEB_DIR%\manifest.json" "%ASSETS%\" >nul

echo   复制应用图标 ...
if exist "%PROJECT_DIR%icons\icon.png" (
    for %%M in (mipmap-mdpi mipmap-hdpi mipmap-xhdpi mipmap-xxhdpi) do (
        if not exist "%PRJ%\app\src\main\res\%%M" mkdir "%PRJ%\app\src\main\res\%%M"
        copy /y "%PROJECT_DIR%icons\icon.png" "%PRJ%\app\src\main\res\%%M\ic_launcher.png" >nul
    )
    echo     + icons\icon.png
) else (
    echo   [警告] 未找到 icons\icon.png，将使用系统默认图标。
)
if exist "%PROJECT_DIR%icons\icon-512.png" (
    if not exist "%PRJ%\app\src\main\res\mipmap-xxxhdpi" mkdir "%PRJ%\app\src\main\res\mipmap-xxxhdpi"
    copy /y "%PROJECT_DIR%icons\icon-512.png" "%PRJ%\app\src\main\res\mipmap-xxxhdpi\ic_launcher.png" >nul
)

echo   壳工程生成完毕。
exit /b 0

REM ----------------------------------------------------------------------------
:ensureGradle
set "PRJ=%WRAPPER_DIR%"
set "GRADLE_CMD="

REM 优先用已存在的 wrapper（可复现，且不依赖 PATH）
if exist "%PRJ%\gradlew.bat" (
    set "GRADLE_CMD=%PRJ%\gradlew.bat"
    echo   使用已有 Gradle Wrapper。
    exit /b 0
)

REM 其次用 PATH 上的 gradle，并用它就地生成 wrapper
where gradle >nul 2>&1
if not errorlevel 1 (
    echo   使用系统 Gradle 生成 Wrapper ^( %GRADLE_VERSION% ^) ...
    pushd "%PRJ%"
    call gradle wrapper --gradle-version %GRADLE_VERSION% --distribution-type bin -q
    popd
    if exist "%PRJ%\gradlew.bat" (
        set "GRADLE_CMD=%PRJ%\gradlew.bat"
        echo   Wrapper 已生成。
        exit /b 0
    )
    set "GRADLE_CMD=gradle"
    exit /b 0
)

REM 都没有 —— 尝试下载
if "%ALLOW_GRADLE_DOWNLOAD%"=="0" goto :gradleMissing

set "GRADLE_HOME=%CACHE_DIR%\gradle-%GRADLE_VERSION%"
set "GRADLE_ZIP=%CACHE_DIR%\gradle-%GRADLE_VERSION%-bin.zip"
if not exist "%CACHE_DIR%" mkdir "%CACHE_DIR%"

if not exist "%GRADLE_HOME%\bin\gradle.bat" (
    echo   未检测到 Gradle，正在下载 Gradle %GRADLE_VERSION% ^(需要联网，约 100MB^) ...
    powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol='Tls12'; if (-not (Test-Path '%GRADLE_ZIP%')) { Invoke-WebRequest -Uri '%GRADLE_DIST_BASE%/gradle-%GRADLE_VERSION%-bin.zip' -OutFile '%GRADLE_ZIP%' }; if (-not (Test-Path '%GRADLE_HOME%')) { Expand-Archive -Path '%GRADLE_ZIP%' -DestinationPath '%CACHE_DIR%' -Force }"
    if errorlevel 1 (
        echo   [错误] Gradle 下载失败。
        goto :gradleMissing
    )
)

if not exist "%GRADLE_HOME%\bin\gradle.bat" goto :gradleMissing

echo   用下载的 Gradle 生成 Wrapper ...
pushd "%PRJ%"
call "%GRADLE_HOME%\bin\gradle.bat" wrapper --gradle-version %GRADLE_VERSION% --distribution-type bin -q
popd
if exist "%PRJ%\gradlew.bat" (
    set "GRADLE_CMD=%PRJ%\gradlew.bat"
    exit /b 0
)
set "GRADLE_CMD=%GRADLE_HOME%\bin\gradle.bat"
exit /b 0

:gradleMissing
echo.
echo   [错误] 找不到 Gradle，也未能自动下载。
echo         请任选一种方式：
echo           1^) 用包管理器装： choco install gradle   或   scoop install gradle
echo           2^) 手动下载 %GRADLE_VERSION% 并把 bin 目录加入 PATH
echo               %GRADLE_DIST_BASE%/gradle-%GRADLE_VERSION%-bin.zip
echo           3^) 装 Android Studio，用 IDE 打开 android-build 目录直接构建
exit /b 1

REM ----------------------------------------------------------------------------
:buildApk
set "PRJ=%WRAPPER_DIR%"

if "%BUILD_TYPE%"=="release" (
    call :ensureKeystore
    if errorlevel 1 exit /b 1
)

set "GRADLE_TASK=assembleDebug"
if "%BUILD_TYPE%"=="release" set "GRADLE_TASK=assembleRelease"

echo   开始编译（%BUILD_TYPE%）——首次构建需要联网下载依赖，请耐心等待 ...
echo.

pushd "%PRJ%"
call "%GRADLE_CMD%" %GRADLE_TASK% --no-daemon
set "BUILD_RC=%ERRORLEVEL%"
popd

if not "%BUILD_RC%"=="0" (
    echo.
    echo   [错误] Gradle 构建失败（退出码 %BUILD_RC%）。
    echo         常见原因：
    echo           - 首次构建需要联网下载 AGP 依赖，网络不通会卡住或失败
    echo           - Android SDK 缺少 android-%COMPILE_SDK% 平台或 build-tools
    echo           - JDK 版本与 AGP %AGP_VERSION% 不匹配
    echo         完整日志见上方输出，可加 --stacktrace 排查。
    exit /b 1
)
echo.
echo   编译成功。
exit /b 0

REM ----------------------------------------------------------------------------
:ensureKeystore
if exist "%KEYSTORE_FILE%" (
    echo   使用已有签名文件 : %KEYSTORE_FILE%
) else (
    echo   未找到签名文件，正在生成正式签名 keystore ...
    echo   [注意] 这是自动生成的调试级签名，正式上架请换成自己的 keystore 并妥善保管！
    if not defined KEYTOOL_EXE set "KEYTOOL_EXE=%JAVA_HOME%\bin\keytool.exe"
    if not exist "%KEYTOOL_EXE%" (
        echo   [错误] 找不到 keytool：%KEYTOOL_EXE%
        exit /b 1
    )
    "%KEYTOOL_EXE%" -genkeypair -v -keystore "%KEYSTORE_FILE%" -alias %KEY_ALIAS% -keyalg RSA -keysize 2048 -validity 10000 -storepass %KEYSTORE_PASS% -keypass %KEY_PASS% -dname "CN=EarthOnline, OU=Dev, O=%PACKAGE_ID%, L=Unknown, S=Unknown, C=CN"
    if errorlevel 1 (
        echo   [错误] keystore 生成失败。
        exit /b 1
    )
    echo   keystore 已生成 : %KEYSTORE_FILE%
)

REM 把签名参数写成 keystore.properties 供 Gradle 读取。
REM 注意：路径里的反斜杠在 .properties 中必须写成 /，否则会被当成转义符吃掉。
set "KS_FWD=%KEYSTORE_FILE:\=/%"
echo storeFile=%KS_FWD%> "%WRAPPER_DIR%\keystore.properties"
echo storePassword=%KEYSTORE_PASS%>> "%WRAPPER_DIR%\keystore.properties"
echo keyAlias=%KEY_ALIAS%>> "%WRAPPER_DIR%\keystore.properties"
echo keyPassword=%KEY_PASS%>> "%WRAPPER_DIR%\keystore.properties"
echo   签名配置已写入 android-build\keystore.properties
exit /b 0

REM ----------------------------------------------------------------------------
:collectOutput
set "APK_SRC=%WRAPPER_DIR%\app\build\outputs\apk\%BUILD_TYPE%\app-%BUILD_TYPE%.apk"
if not exist "%APK_SRC%" (
    echo   [错误] 未找到构建产物：%APK_SRC%
    exit /b 1
)
if not exist "%DIST_DIR%" mkdir "%DIST_DIR%"
set "APK_DST=%DIST_DIR%\EarthOnline-%VERSION_NAME%-%BUILD_TYPE%.apk"
copy /y "%APK_SRC%" "%APK_DST%" >nul
if errorlevel 1 (
    echo   [错误] 复制 APK 失败。
    exit /b 1
)

set "APK_SIZE=0"
for %%F in ("%APK_DST%") do set "APK_SIZE=%%~zF"
set /a APK_MB=%APK_SIZE% / 1048576
echo.
echo   APK 已输出 : %APK_DST%
echo   文件大小   : %APK_SIZE% 字节 ^( 约 %APK_MB% MB ^)

if "%DO_INSTALL%"=="1" (
    if exist "%ANDROID_SDK%\platform-tools\adb.exe" (
        echo.
        echo   正在安装到设备 ...
        "%ANDROID_SDK%\platform-tools\adb.exe" install -r "%APK_DST%"
    ) else (
        echo   [警告] 未找到 adb，跳过安装。
    )
)
exit /b 0

REM ----------------------------------------------------------------------------
:doClean
echo.
if exist "%WRAPPER_DIR%" (
    echo   删除 %WRAPPER_DIR% ...
    rmdir /s /q "%WRAPPER_DIR%"
)
if exist "%DIST_DIR%" (
    echo   删除 %DIST_DIR% ...
    rmdir /s /q "%DIST_DIR%"
)
echo   清理完成。
goto :eof

REM ----------------------------------------------------------------------------
:fail
echo.
echo  ============================================================
echo    构建失败 —— 请根据上方提示修复后重新运行。
echo  ============================================================
exit /b 1

:done
echo.
echo  ============================================================
echo    全部完成！APK 位于 dist 目录。
echo    提示：正式发布请改用自己的 keystore，不要用脚本自动生成的那个。
echo  ============================================================
exit /b 0
