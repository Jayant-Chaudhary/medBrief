import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { ToastProvider } from './context/ToastContext';
import { PatientProvider } from './context/PatientContext';
import { AppRoutes } from './routes/AppRoutes.jsx';
import AssistantDock from './components/assistant/AssistantDock.jsx';
import { AssistantBridgeProvider } from './components/assistant/AssistantBridge.jsx';

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <PatientProvider>
            <BrowserRouter>
              <AssistantBridgeProvider>
                <AppRoutes />
                <AssistantDock />
              </AssistantBridgeProvider>
            </BrowserRouter>
          </PatientProvider>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
