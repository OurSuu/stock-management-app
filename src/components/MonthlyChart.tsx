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
// Removed unused type-only imports to fix TS6192 error
// @ts-ignore-next-line
import ChartDataLabels from 'chartjs-plugin-datalabels';

ChartJS.register(
    CategoryScale,
    LinearScale,
    BarElement,
    Title,
    Tooltip,
    Legend,
    ChartDataLabels
);

type MonthlyData = {
    monthLabel: string;
    received: number;
    used: number;
    sortKey: string;
    details: {
        received: { [key: string]: number };
        used: { [key: string]: number };
    };
};

const MonthlyChart: React.FC = () => {
    const [chartData, setChartData] = useState<MonthlyData[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);

            const d = new Date();
            d.setMonth(d.getMonth() - 11);
            d.setDate(1);
            d.setHours(0, 0, 0, 0);

            const { data: transactions, error } = await supabase
                .from('transactions')
                .select('created_at, type, quantity_change, products(name, unit)')
                .gte('created_at', d.toISOString())
                .order('created_at', { ascending: true });

            if (error) {
                console.error('Error:', error);
                setIsLoading(false);
                return;
            }

            const groupedData = new Map<string, MonthlyData>();

            transactions?.forEach((t: any) => {
                const dateObj = new Date(t.created_at);
                const thaiTime = new Date(dateObj.getTime() + (7 * 60 * 60 * 1000));
                const key = thaiTime.toISOString().slice(0, 7);
                const label = thaiTime.toLocaleDateString('th-TH', { month: 'short', year: '2-digit' });

                const prodName = t.products?.name || 'ไม่ระบุ';
                const qty = t.quantity_change;

                if (!groupedData.has(key)) {
                    groupedData.set(key, {
                        monthLabel: label,
                        received: 0,
                        used: 0,
                        sortKey: key,
                        details: { received: {}, used: {} }
                    });
                }

                const current = groupedData.get(key)!;

                // Helper เพื่อบวกยอดรายสินค้า
                const addDetail = (type: 'received' | 'used', name: string, amount: number) => {
                    if (!current.details[type][name]) current.details[type][name] = 0;
                    current.details[type][name] += amount;
                    // ถ้าลบกันแล้วเหลือ 0 หรือติดลบ ให้ลบ key ออก (จะได้ไม่รก)
                    if (current.details[type][name] <= 0) delete current.details[type][name];
                };

                if (t.type === 'ADD') {
                    current.received += qty;
                    addDetail('received', prodName, qty);
                } else if (t.type === 'REMOVE') {
                    current.used += Math.abs(qty);
                    addDetail('used', prodName, Math.abs(qty));
                } else if (t.type === 'RESTORE') {
                    // ✅ Logic ใหม่: ถ้ากู้คืน ให้ไป "ลบออกจากยอดใช้"
                    const absQty = Math.abs(qty);
                    current.used -= absQty;
                    // ลดยอดใน details ด้วย (ต้องลบออกจาก used)
                    if (current.details.used[prodName]) {
                        current.details.used[prodName] -= absQty;
                        if (current.details.used[prodName] <= 0) delete current.details.used[prodName];
                    }
                }
            });

            const result = Array.from(groupedData.values()).sort((a, b) =>
                a.sortKey.localeCompare(b.sortKey)
            );
            setChartData(result);
            setIsLoading(false);
        };

        fetchData();
    }, []);

    const data = {
        labels: chartData.map(obj => obj.monthLabel),
        datasets: [
            {
                label: 'รับเข้า',
                data: chartData.map(obj => obj.received),
                backgroundColor: 'rgba(34, 197, 94, 0.8)',
                borderColor: '#16a34a',
                borderWidth: 1,
                borderRadius: 4,
                barPercentage: 0.6,
                categoryPercentage: 0.8,
                datalabels: {
                    anchor: 'end' as const, align: 'top' as const, color: '#16a34a', font: { weight: 'bold' as const },
                    formatter: (value: number) => value > 0 ? value : ''
                }
            },
            {
                label: 'เบิกใช้',
                data: chartData.map(obj => obj.used),
                backgroundColor: 'rgba(239, 68, 68, 0.8)',
                borderColor: '#dc2626',
                borderWidth: 1,
                borderRadius: 4,
                barPercentage: 0.6,
                categoryPercentage: 0.8,
                datalabels: {
                    anchor: 'end' as const, align: 'top' as const, color: '#dc2626', font: { weight: 'bold' as const },
                    formatter: (value: number) => value > 0 ? value : ''
                }
            },
        ],
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 20 } },
        plugins: {
            legend: { position: 'top', align: 'end', labels: { font: { family: "'Kanit', sans-serif" }, usePointStyle: true } },
            tooltip: {
                enabled: true,
                titleFont: { family: "'Kanit', sans-serif", size: 14 },
                bodyFont: { family: "'Kanit', sans-serif", size: 13 },
                callbacks: {
                    // ✅ Custom Tooltip: แสดงรายละเอียดสินค้า
                    label: function(context: any) {
                        const index = context.dataIndex;
                        const type = context.datasetIndex === 0 ? 'received' : 'used';
                        const total = context.raw;

                        // ดึงรายละเอียดมาโชว์
                        const detailsObj = chartData[index].details[type];
                        const detailsStr = Object.entries(detailsObj)
                            .map(([name, qty]) => `${name}: ${qty}`)
                            .join(', ');

                        return [`ยอดรวม: ${total}`, ...(detailsStr ? [`----------`, ...Object.entries(detailsObj).map(([n, q]) => `• ${n}: ${q}`)] : [])];
                    }
                }
            },
            datalabels: { display: true, font: { family: "'Kanit', sans-serif" } }
        },
        scales: {
            y: { beginAtZero: true, grid: { color: '#f3f4f6' }, ticks: { font: { family: "'Kanit', sans-serif" } } },
            x: { grid: { display: false }, ticks: { font: { family: "'Kanit', sans-serif" } } }
        },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
    };

    if (isLoading) return (
        <div className="h-64 flex items-center justify-center text-slate-400">
            <div className="animate-spin h-8 w-8 border-4 border-indigo-200 border-t-indigo-600 rounded-full mr-3"></div>
            กำลังโหลดข้อมูล...
        </div>
    );

    if (chartData.length === 0) return (
        <div className="h-64 flex flex-col items-center justify-center text-slate-400 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
            <span className="text-4xl mb-2">📊</span>
            <p>ยังไม่มีข้อมูลธุรกรรมในรอบปีนี้</p>
        </div>
    );

    return (
        <div className="w-full h-[350px]">
            <Bar options={options} data={data} />
        </div>
    );
};

export default MonthlyChart;