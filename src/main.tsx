import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AppCrash, ErrorBoundary } from './ui/ErrorBoundary'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={(e) => <AppCrash error={e} />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
