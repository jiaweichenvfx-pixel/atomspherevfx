import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 第一遍：打包 app 代码 + three 加 addons 到一个 IIFE 中
await esbuild.build({
  entryPoints: ['js/main.js'],
  bundle: true,
  format: 'iife',
  globalName: 'App',
  outfile: 'dist/app.bundle.js',
  plugins: [{
    name: 'resolve-three-addons',
    setup(build) {
      build.onResolve({ filter: /^three\/addons\// }, args => {
        const subpath = args.path.replace('three/addons/', '');
        return {
          path: path.resolve(__dirname, 'node_modules/three/examples/jsm', subpath),
          external: false
        };
      });
    }
  }],
  // 将 three 模块中的构建/运行时警告静音
  logLevel: 'warning'
});

console.log('Build OK:', (await import('fs')).statSync('dist/app.bundle.js').size, 'bytes');
