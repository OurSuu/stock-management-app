import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import StockActionModal from '../components/StockActionModal';

// Define Types
type ProductStock = {
  id: number;
  name: string;
  unit: string;
  min_alert_quantity: number;
  current_quantity: number;
};

type SummaryItem = {
  name: string;
  unit: string;
  received: number;
  used: number;
};

const BranchStock: React.FC = () => {
  const { branch } = useAuth();

  // State สำหรับ Tabs และ Data
  const [activeTab, setActiveTab] = useState<'stock' | 'history' | 'summary'>('stock');
  const [stock, setStock] = useState<ProductStock[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [summary, setSummary] = useState<{ today: SummaryItem[]; month: SummaryItem[] }>({
    today: [],
    month: [],
  });

  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchData = useCallback(async () => {
    if (!branch?.id) return;
    setIsLoading(true);

    // 1. ดึง Stock ล่าสุด
    const { data: stockData } = await supabase
      .from('stock')
      .select(`id, current_quantity, products ( name, unit, min_alert_quantity )`)
      .eq('branch_id', branch.id);

    const formattedStock: ProductStock[] = (stockData ?? []).map((item: any) => {
      const prod = Array.isArray(item.products) ? item.products[0] : item.products;
      if (!prod) return null;
      return {
        id: item.id,
        current_quantity: item.current_quantity,
        name: prod.name,
        unit: prod.unit,
        min_alert_quantity: prod.min_alert_quantity,
      };
    }).filter(Boolean) as ProductStock[];

    setStock(formattedStock);

    // 2. ดึง Transactions เพื่อคำนวณสรุปผล
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: txnData } = await supabase
      .from('transactions')
      .select('*, products(name, unit)')
      .eq('branch_id', branch.id)
      .gte('created_at', startOfMonth.toISOString());

    // 3. Logic คำนวณสรุปผล (เหมือน Dashboard)
    const todayStr = new Date().toLocaleDateString('th-TH');
    const todayMap = new Map<string, SummaryItem>();
    const monthMap = new Map<string, SummaryItem>();

    const getOrInit = (map: Map<string, SummaryItem>, key: string, name: string, unit: string) => {
      if (!map.has(key)) map.set(key, { name, unit, received: 0, used: 0 });
      return map.get(key)!;
    };

    txnData?.forEach((t: any) => {
      const txnDate = new Date(t.created_at).toLocaleDateString('th-TH');
      const prodName = t.products?.name || 'ไม่ระบุชื่อ';
      const unit = t.products?.unit || '';
      const qty = t.quantity_change;
      const type = t.type;

      // ยอดเดือน
      const monthItem = getOrInit(monthMap, prodName, prodName, unit);
      if (type === 'ADD') monthItem.received += qty;
      else monthItem.used += Math.abs(qty);

      // ยอดวัน
      if (txnDate === todayStr) {
        const todayItem = getOrInit(todayMap, prodName, prodName, unit);
        if (type === 'ADD') todayItem.received += qty;
        else todayItem.used += Math.abs(qty);
      }
    });

    setSummary({
      today: Array.from(todayMap.values()),
      month: Array.from(monthMap.values()),
    });

    // 4. ดึงประวัติ 20 รายการล่าสุด
    const { data: recentHistory } = await supabase
      .from('transactions')
      .select('*, products(name, unit)')
      .eq('branch_id', branch.id)
      .order('created_at', { ascending: false })
      .limit(20);
    setHistory(recentHistory || []);

    setIsLoading(false);
  }, [branch?.id]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (isLoading)
    return (
      <div className="p-10 text-center">
        <div className="animate-spin h-10 w-10 border-4 border-indigo-600 rounded-full border-t-transparent mx-auto"></div>
      </div>
    );

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 animate-fade-in space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl">📦</span>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">จัดการสต็อก</h2>
            <p className="text-slate-500">สาขา: {branch?.branch_name}</p>
          </div>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-indigo-600 text-white px-6 py-3 rounded-xl shadow-lg hover:bg-indigo-700 hover:shadow-indigo-500/30 transition transform hover:-translate-y-0.5 flex items-center font-bold"
        >
          <span className="mr-2 text-xl">+</span> ทำรายการสินค้า
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex space-x-2 bg-white p-1.5 rounded-xl shadow-sm w-fit overflow-x-auto max-w-full">
        <button
          onClick={() => setActiveTab('stock')}
          className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
            activeTab === 'stock'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          📦 สต็อกคงเหลือ
        </button>
        <button
          onClick={() => setActiveTab('summary')}
          className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
            activeTab === 'summary'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          📊 สรุปผลการใช้
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
            activeTab === 'history'
              ? 'bg-indigo-600 text-white shadow-md'
              : 'text-slate-500 hover:bg-slate-50'
          }`}
        >
          📜 ประวัติรายการ
        </button>
      </div>
      {/* --- Content Area --- */}

      {/* Tab 1: Stock Table */}
      {activeTab === 'stock' && (
        <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden animate-slide-up">
          <table className="min-w-full">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-bold text-slate-500 uppercase tracking-wider">
                  สินค้า
                </th>
                <th className="px-6 py-4 text-center text-xs font-bold text-slate-500 uppercase tracking-wider">
                  สถานะ
                </th>
                <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">
                  คงเหลือ
                </th>
                <th className="px-6 py-4 text-right text-xs font-bold text-slate-500 uppercase tracking-wider">
                  หน่วย
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {stock.map((item) => (
                <tr key={item.id} className="hover:bg-slate-50/50 transition">
                  <td className="px-6 py-4 text-sm font-bold text-slate-700">{item.name}</td>
                  <td className="px-6 py-4 text-center">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium 
                                            ${
                                              item.current_quantity <= 0
                                                ? 'bg-red-100 text-red-800'
                                                : item.current_quantity < item.min_alert_quantity
                                                ? 'bg-orange-100 text-orange-800'
                                                : 'bg-green-100 text-green-800'
                                            }`}
                    >
                      {item.current_quantity <= 0
                        ? 'หมดสต็อก'
                        : item.current_quantity < item.min_alert_quantity
                        ? 'ใกล้หมด'
                        : 'ปกติ'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-right font-mono font-bold text-slate-800 text-lg">
                    {item.current_quantity}
                  </td>
                  <td className="px-6 py-4 text-sm text-right text-slate-500">{item.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {stock.length === 0 && (
            <div className="p-10 text-center text-slate-400">
              ไม่มีข้อมูลสินค้าในสต็อก
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Summary Cards */}
      {activeTab === 'summary' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-slide-up">
          {/* รายวัน */}
          <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 overflow-hidden">
            <div className="bg-indigo-50 p-4 border-b border-indigo-100 flex items-center justify-between">
              <h3 className="font-bold text-indigo-700">
                📅 วันนี้ ({new Date().toLocaleDateString('th-TH')})
              </h3>
            </div>
            <div className="p-4">
              {summary.today.length === 0 ? (
                <div className="text-center text-slate-400 py-10">
                  วันนี้ยังไม่มีรายการเคลื่อนไหว
                </div>
              ) : (
                <ul className="space-y-3">
                  {summary.today.map((item, idx) => (
                    <li
                      key={idx}
                      className="flex justify-between items-center border-b border-slate-50 pb-2 last:border-0"
                    >
                      <span className="text-slate-700 font-medium">{item.name}</span>
                      <div className="flex gap-2 text-sm font-bold">
                        {item.received > 0 && (
                          <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded">
                            รับ {item.received}
                          </span>
                        )}
                        {item.used > 0 && (
                          <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded">
                            ใช้ {item.used}
                          </span>
                        )}
                        <span className="text-gray-400 self-center ml-1 font-normal">{item.unit}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* รายเดือน */}
          <div className="bg-white rounded-2xl shadow-sm border border-orange-100 overflow-hidden">
            <div className="bg-orange-50 p-4 border-b border-orange-100 flex items-center justify-between">
              <h3 className="font-bold text-orange-700">🗓️ เดือนนี้</h3>
              <span className="text-xs bg-white text-orange-600 px-2 py-1 rounded-md font-bold">
                Accumulated
              </span>
            </div>
            <div className="p-4">
              {summary.month.length === 0 ? (
                <div className="text-center text-slate-400 py-10">เดือนนี้ยังไม่มีรายการเคลื่อนไหว</div>
              ) : (
                <ul className="space-y-3">
                  {summary.month.map((item, idx) => (
                    <li
                      key={idx}
                      className="flex justify-between items-center border-b border-slate-50 pb-2 last:border-0"
                    >
                      <span className="text-slate-700 font-medium">{item.name}</span>
                      <div className="flex gap-2 text-sm font-bold">
                        {item.received > 0 && (
                          <span className="text-green-600 bg-green-50 px-2 py-0.5 rounded">
                            รับ {item.received}
                          </span>
                        )}
                        {item.used > 0 && (
                          <span className="text-red-600 bg-red-50 px-2 py-0.5 rounded">ใช้ {item.used}</span>
                        )}
                        <span className="text-gray-400 self-center ml-1 font-normal">{item.unit}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: History List */}
      {activeTab === 'history' && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden animate-slide-up">
          {history.length === 0 ? (
            <div className="p-10 text-center text-slate-400">ยังไม่มีประวัติการทำรายการ</div>
          ) : (
            <div className="divide-y divide-slate-50">
              {history.map((txn: any) => (
                <div
                  key={txn.id}
                  className="flex justify-between items-center p-4 px-6 hover:bg-slate-50 transition"
                >
                  <div className="flex items-center">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center mr-4 ${
                        txn.type === 'ADD'
                          ? 'bg-green-100 text-green-600'
                          : 'bg-red-100 text-red-600'
                      }`}
                    >
                      {txn.type === 'ADD' ? '📥' : '📤'}
                    </div>
                    <div>
                      <p className="font-bold text-slate-800">
                        {txn.type === 'ADD' ? 'รับของเข้า' : 'เบิกของออก'}
                        <span className="text-indigo-600 ml-2">{txn.products?.name}</span>
                      </p>
                      <p className="text-xs text-slate-400">
                        {new Date(txn.created_at).toLocaleString('th-TH')} โดย {txn.performed_by}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`font-bold text-lg ${
                      txn.type === 'ADD' ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {txn.type === 'ADD' ? '+' : '-'}
                    {txn.quantity_change} {txn.products?.unit}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {isModalOpen && branch && (
        <StockActionModal
          onClose={() => setIsModalOpen(false)}
          onSuccess={fetchData}
          branchId={branch.id}
          loginCode={branch.login_code}
        />
      )}
    </div>
  );
};

export default BranchStock;