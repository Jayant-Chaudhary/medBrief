import { BrowserRouter, HashRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ToastProvider } from './context/ToastContext';
import { PatientProvider } from './context/PatientContext';
import { AppRoutes } from './routes/AppRoutes.jsx';

// Electron can load the same React client from an app bundle without server
// rewrite rules; set VITE_ROUTER_MODE=hash for that packaged renderer.
const AppRouter = import.meta.env.VITE_ROUTER_MODE === 'hash' ? HashRouter : BrowserRouter;

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <PatientProvider>
            <AppRouter>
              <AppRoutes />
            </AppRouter>
          </PatientProvider>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
