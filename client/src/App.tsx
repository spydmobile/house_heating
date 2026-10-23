import { Dashboard } from './components/Dashboard';
import { PendingQueueBanner } from './components/PendingQueueBanner';
import { useOfflineQueue } from './offline/useOfflineQueue';

function App() {
  const { pending, error, flush } = useOfflineQueue();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/*
          Above the dashboard on purpose. Anything queued is, by definition,
          not yet in the numbers shown below — so the fact that something is
          outstanding has to be visible before the figures are read, not after.
        */}
        <PendingQueueBanner pending={pending} error={error} onRetry={() => void flush()} />

        <Dashboard />
      </div>
    </div>
  );
}

export default App;
