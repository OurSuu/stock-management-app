import { useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import BranchStock from './pages/BranchStock';

function App() {
  const { isLoggedIn, branch, isAdmin } = useAuth();

  if (!isLoggedIn) {
    return <Login />;
  }

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
      {/* Navbar */}
      <nav className="bg-white shadow-sm sticky top-0 z-30 border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <span className="bg-indigo-600 text-white p-2 rounded-lg mr-3 shadow-lg">📦</span>
              <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600">
                {isAdmin ? "Dashboard ผู้บริหาร" : `จัดการสต็อก: ${branch?.branch_name}`}
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="hidden sm:flex flex-col items-end mr-2">
                <span className="text-sm font-bold text-gray-700">{branch?.branch_name}</span>
                <span className="text-xs text-gray-400">{isAdmin ? 'Administrator' : 'Branch Manager'}</span>
              </div>
              <button
                onClick={useAuth().logout}
                className="bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600 px-4 py-2 rounded-lg transition duration-300 text-sm font-medium"
              >
                ออกจากระบบ
              </button>
            </div>
          </div>
        </div>
      </nav>
      
      <main className="py-6">
        {isAdmin ? <Dashboard /> : <BranchStock />}
      </main>
    </div>
  );
}

export default App;