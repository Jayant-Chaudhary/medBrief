import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { Stepper } from '../components/ui/Stepper';
import { ThemeToggle } from '../components/common/ThemeToggle.jsx';

export default function CheckinLayout() {
  const navigate = useNavigate();
  const location = useLocation();

  const handleBack = () => {
    // Basic back navigation
    navigate(-1);
  };

  const steps = [
    {
      label: "Reports",
      isActive: location.pathname.includes('reports'),
      isCompleted: location.pathname.includes('symptoms') || location.pathname.includes('checklist') || location.pathname.includes('done'),
    },
    {
      label: "Symptoms",
      isActive: location.pathname.includes('symptoms'),
      isCompleted: location.pathname.includes('checklist') || location.pathname.includes('done'),
    },
    {
      label: "Checklist",
      isActive: location.pathname.includes('checklist'),
      isCompleted: location.pathname.includes('done'),
    },
  ];

  return (
    <div className="min-h-screen bg-canvas flex flex-col relative pb-24 shadow-xl overflow-hidden max-w-3xl mx-auto">
      {/* Stepper Header */}
      <header className="bg-raised border-b border-ink-soft/10 px-4 py-4 sticky top-0 z-40">
        <div className="flex items-center gap-4 mb-4">
          <button onClick={handleBack} className="p-2 -ml-2 rounded-full hover:bg-canvas transition-colors">
            <ChevronLeft size={24} className="text-ink" />
          </button>
          <h1 className="text-xl font-bold text-ink">Pre-Visit Check-in</h1>
          <ThemeToggle className="ml-auto" />
        </div>
        <Stepper steps={steps} />
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 w-full">
        <Outlet />
      </main>
    </div>
  );
}
