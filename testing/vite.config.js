import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import {fileURLToPath} from 'node:url'
export default defineConfig({root:fileURLToPath(new URL('..',import.meta.url)),plugins:[react(),{name:'testing-title',transformIndexHtml:html=>html.replace(/<title>.*?<\/title>/,'<title>DriveWise Testing | Downtown Ministries</title>')}],define:{'import.meta.env.VITE_DRIVEWISE_TESTING':'true'},build:{outDir:'testing/dist',emptyOutDir:true}})
