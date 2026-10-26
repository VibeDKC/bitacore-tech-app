import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

const root = __dirname

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': path.resolve(root, 'src/types')
      }
    },
    build: {
      rollupOptions: {
        input: path.resolve(root, 'electron/main/index.ts')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': path.resolve(root, 'src/types')
      }
    },
    build: {
      rollupOptions: {
        input: path.resolve(root, 'electron/preload/index.ts')
      }
    }
  },
  renderer: {
    root,
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(root, 'src')
      }
    },
    build: {
      rollupOptions: {
        input: path.resolve(root, 'index.html')
      }
    },
    server: {
      watch: {
        ignored: ['**/release/**', '**/dist/**', '**/out/**', '**/build/**']
      }
    }
  }
})
