const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Bundle the on-device model (assets/model/model.tflite).
config.resolver.assetExts.push('tflite');

module.exports = config;
