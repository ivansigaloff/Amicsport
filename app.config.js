module.exports = ({ config }) => {
  const baseUrl = process.env.EXPO_PUBLIC_BASE_URL || '/';
  
  // Este mensaje aparecerá en tu terminal al exportar
  console.log(`\n[Expo Build] Configurando baseUrl con el valor: "${baseUrl}"\n`);
  
  return {
    ...config,
    name: "AmicSport",
    slug: "AmicSport",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/images/icon.png",
    scheme: "amicsport",
    userInterfaceStyle: "automatic",
    newArchEnabled: true,
    ios: {
      supportsTablet: true
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/images/android-icon-foreground.png",
        backgroundImage: "./assets/images/android-icon-background.png",
        monochromeImage: "./assets/images/android-icon-monochrome.png"
      },
      edgeToEdgeEnabled: true,
      predictiveBackGestureEnabled: false,
      package: "com.avelino.trocola.AmicSport"
    },
    web: {
      output: "static",
      favicon: "./assets/images/favicon.png"
    },
    plugins: [
      "expo-router",
      [
        "expo-splash-screen",
        {
          "image": "./assets/images/splash-icon.png",
          "imageWidth": 200,
          "resizeMode": "contain",
          "backgroundColor": "#ffffff",
          "dark": {
            "backgroundColor": "#000000"
          }
        }
      ],
      "@react-native-community/datetimepicker",
      "expo-web-browser"
    ],
    experiments: {
      ...(config.experiments || {}),
      typedRoutes: true,
      reactCompiler: true,
      // Detección dinámica de baseUrl basada en variable de entorno
      baseUrl: baseUrl
    },
    extra: {
      router: {},
      eas: {
        projectId: "c3aa473c-bd35-4e63-a3ac-25e9686364b2"
      }
    }
  };
};
