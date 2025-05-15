module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      [
        'module-resolver',
        {
          root: ['./'],
          extensions: ['.ios.js', '.android.js', '.js', '.ts', '.tsx', '.json'],
          alias: {
            '@components': './components',
            '@screens': './src/screens',
            '@contexts': './src/contexts',
            '@navigation': './src/navigation',
            '@config': './src/config',
          },
        },
      ],
    ],
  };
}; 