import {Component, ErrorInfo, ReactNode, StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  hasError: boolean;
}

class AppErrorBoundary extends Component<{children: ReactNode}, ErrorBoundaryState> {
  state: ErrorBoundaryState = {hasError: false};

  static getDerivedStateFromError(): ErrorBoundaryState {
    return {hasError: true};
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Kevin AI UI error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-[#f0f2f5] dark:bg-[#111b21] text-center">
          <div className="max-w-sm w-full rounded-2xl bg-white dark:bg-[#202c33] p-6 shadow-lg border border-gray-200 dark:border-[#2f3b43] space-y-4">
            <h1 className="text-lg font-bold text-[#075E54] dark:text-[#00FF88]">Kevin AI</h1>
            <p className="text-sm text-gray-600 dark:text-[#d1d7db]">
              Habaye akabazo gato mu gufungura dosiye cyangwa ifoto. Kanda hasi wongere ufungure neza.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full py-2.5 px-4 rounded-xl bg-[#00a884] hover:bg-[#075E54] text-white font-semibold text-sm cursor-pointer"
            >
              Ongera ufungure Kevin AI
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
