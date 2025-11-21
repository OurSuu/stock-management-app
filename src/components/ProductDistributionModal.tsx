import React, { useState, useEffect } from 'react';

import { supabase } from '../lib/supabase';

import { Bar } from 'react-chartjs-2';

import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend,
} from 'chart.js';

// ลงทะเบียน Plugin พื้นฐาน
ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

type BranchStockData = {
    branch_name: string;
    quantity: number;
};

const ProductDistributionModal: React.FC<{ 
    onClose: () => void 
}> = ({ onClose }) => {
    const [products, setProducts] = useState<{ id: string, name: string }[]>([]);
    const [selectedProduct, setSelectedProduct] = useState('');
    const [chartData, setChartData] = useState<BranchStockData[]>([]);
    const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
    const [isLoading, setIsLoading] = useState(false);

    // 1. โหลดรายชื่อสินค้า
    useEffect(() => {
        const fetchProducts = async () => {
            const { data } = await supabase.from('products').select('id, name').order('name');
            if (data && data.length > 0) {
                setProducts(data);
                setSelectedProduct(data[0].id);
            }
        };
        fetchProducts();
    }, []);

    // 2. โหลดข้อมูลสต็อก
    useEffect(() => {
        if (!selectedProduct) return;

        const fetchStockData = async () => {
            setIsLoading(true);
            
            const { data } = await supabase
                .from('stock')
                .select('current_quantity, branches(branch_name)')
                .eq('product_id', selectedProduct);

            // ✅ เพิ่มบรรทัดนี้: กรองเอาเฉพาะที่มากกว่า 0 (ไม่เอาติดลบ ไม่เอา 0)
            const formattedData: BranchStockData[] = (data || [])
                .filter((item: any) => item.current_quantity > 0)
                .map((item: any) => ({
                    branch_name: item.branches?.branch_name || 'ไม่ระบุสาขา',
                    quantity: item.current_quantity
                }));

            const sortedData = formattedData.sort((a, b) => {
                return sortOrder === 'desc' 
                    ? b.quantity - a.quantity 
                    : a.quantity - b.quantity;
            });

            setChartData(sortedData);
            setIsLoading(false);
        };

        fetchStockData();
    }, [selectedProduct, sortOrder]);

    // --- Custom Plugin: วาดข้อความในแท่งกราฟ ---
    const barLabelPlugin = {
        id: 'barLabelPlugin',
        afterDatasetsDraw(chart: any) {
            const { ctx } = chart;
            ctx.save();
            ctx.font = 'bold 14px "Kanit", sans-serif';
            ctx.textBaseline = 'middle';

            chart.getDatasetMeta(0).data.forEach((datapoint: any, index: number) => {
                const { x, y, base } = datapoint;
                const width = x - base;

                const label = chart.data.labels[index];
                const value = chart.data.datasets[0].data[index];

                if (value > 0) {
                    // 1. วาดชื่อสาขา (ชิดซ้ายในแท่ง)
                    ctx.fillStyle = '#ffffff';
                    ctx.textAlign = 'left';
                    if (width > 50) {
                        ctx.fillText(label, base + 15, y);
                    }

                    // 2. วาดตัวเลข (ชิดขวาในแท่ง)
                    ctx.textAlign = 'right';
                    if (width > 80) {
                        ctx.fillText(`${value} หน่วย`, x - 15, y);
                    } else {
                        ctx.fillStyle = '#333333';
                        ctx.textAlign = 'left';
                        ctx.fillText(value, x + 10, y);
                    }
                }
            });

            ctx.restore();
        }
    };

    const data = {
        labels: chartData.map(d => d.branch_name),
        datasets: [
            {
                label: 'จำนวนคงเหลือ',
                data: chartData.map(d => d.quantity),
                backgroundColor: chartData.map((_, i) => {
                    // ไล่สีตามอันดับ (Ranking Color)
                    if (sortOrder === 'desc') {
                        if (i === 0) return '#7c3aed'; // ม่วงเข้ม (ที่ 1)
                        if (i === 1) return '#8b5cf6'; 
                        if (i === 2) return '#a78bfa'; 
                    }
                    return '#c4b5fd'; // สีพื้นฐาน
                }),
                borderRadius: 8, // แท่งมนๆ
                barThickness: 40, // แท่งอ้วนขึ้นเพื่อให้ใส่ตัวหนังสือได้
                borderSkipped: false,
            },
        ],
    };

    const options = {
        indexAxis: 'y' as const, // แนวนอน
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: { enabled: false }
        },
        layout: {
            padding: { right: 50 }
        },
        scales: {
            x: {
                display: false,
                grid: { display: false }
            },
            y: {
                display: false,
                grid: { display: false }
            }
        }
    };

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 animate-fade-in">
            <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}></div>
            <div className="bg-white w-full max-w-4xl rounded-[2rem] shadow-2xl overflow-hidden relative z-10 flex flex-col max-h-[90vh] animate-slide-up">
                
                {/* Header */}
                <div className="bg-white border-b border-slate-100 p-6 flex justify-between items-center shrink-0">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                            🏆 อันดับสต็อกสินค้า <span className="text-sm font-normal text-slate-500 bg-slate-100 px-2 py-1 rounded-full">Ranking</span>
                        </h2>
                        <p className="text-sm text-slate-500 mt-1">เปรียบเทียบปริมาณสินค้าในแต่ละสาขา</p>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 rounded-full bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800 text-xl transition">✕</button>
                </div>

                {/* Controls */}
                <div className="p-6 bg-slate-50/50 flex flex-col sm:flex-row gap-4 items-center border-b border-slate-100">
                    <div className="w-full sm:w-1/2 relative">
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-1 ml-1">เลือกสินค้า</label>
                        <select 
                            value={selectedProduct} 
                            onChange={(e) => setSelectedProduct(e.target.value)}
                            className="w-full p-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none shadow-sm bg-white font-medium text-slate-700 appearance-none"
                        >
                            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        <div className="absolute right-4 top-9 text-slate-400 pointer-events-none">▼</div>
                    </div>

                    <div className="w-full sm:w-auto flex gap-2 mt-5 sm:mt-0 self-end">
                        <button 
                            onClick={() => setSortOrder('desc')}
                            className={`flex-1 px-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${sortOrder === 'desc' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
                        >
                            <span>⬇️</span> มากไปน้อย
                        </button>
                        <button 
                            onClick={() => setSortOrder('asc')}
                            className={`flex-1 px-4 py-3 rounded-xl font-bold text-sm transition-all flex items-center gap-2 ${sortOrder === 'asc' ? 'bg-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'}`}
                        >
                            <span>⬆️</span> น้อยไปมาก
                        </button>
                    </div>
                </div>

                {/* Chart Area */}
                <div className="flex-1 p-6 bg-white overflow-y-auto min-h-[400px] custom-scrollbar">
                    {isLoading ? (
                         <div className="h-full flex flex-col items-center justify-center text-slate-400">
                             <div className="animate-spin h-10 w-10 border-4 border-indigo-600 rounded-full border-t-transparent mb-4"></div>
                             กำลังโหลดข้อมูล...
                         </div>
                    ) : chartData.length > 0 ? (
                        <div className="h-[500px] w-full">
                            {/* ใส่ Plugin เข้าไปที่นี่ */}
                            <Bar data={data} options={options} plugins={[barLabelPlugin]} />
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 bg-slate-50 rounded-2xl m-4 border-2 border-dashed border-slate-200">
                            <span className="text-4xl mb-2">🔍</span>
                            ไม่พบข้อมูลสต็อกสินค้า
                        </div>
                    )}
                </div>

            </div>
        </div>
    );
};

export default ProductDistributionModal;