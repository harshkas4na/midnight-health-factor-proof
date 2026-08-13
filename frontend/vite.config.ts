import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// NOTE: `vite dev` currently fails to render (wasm-bindgen init error from the
// ledger/onchain-runtime wasm wrappers under Vite's dev-server dependency
// pre-bundling). `vite build` + `vite preview` are unaffected and are what's
// actually deployed -- use `yarn build && yarn preview` for local testing
// until this is root-caused.
export default defineConfig({
  plugins: [react()],
})
