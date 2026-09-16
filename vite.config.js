import {defineConfig} from 'vite';
export default defineConfig({root: 'client', build: {outDir: '../dist', emptyOutDir: true,rollupOptions:{input:{app:'client/index.html',host:'client/host.html'}}}});
