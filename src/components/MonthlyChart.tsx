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
// Import types using type-only imports to fix TS verbatimModuleSyntax errors
import type {
    ChartOptions,
    ChartData,
    ChartDataset,
} from 'chart.js';
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
};

const MonthlyChart: React.FC = () => {
    const [chartData, setChartData] = useState<MonthlyData[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setIsLoading(true);

            // 1. ดึงข้อมูลย้อนหลัง 12 เดือน (เดือนปัจจุบัน + ย้อนหลัง 11 เดือน)
            const d = new Date();
            d.setMonth(d.getMonth() - 11);
            d.setDate(1);
            d.setHours(0, 0, 0, 0);

            const { data: transactions, error } = await supabase
                .from('transactions')
                .select('created_at, type, quantity_change')
                .gte('created_at', d.toISOString())
                .order('created_at', { ascending: true });

            if (error) {
                console.error('Error fetching chart data:', error);
                setIsLoading(false);
                return;
            }

            const groupedData = new Map<string, MonthlyData>();

            transactions?.forEach((t: any) => {
                const dateObj = new Date(t.created_at);
                const thaiTime = new Date(dateObj.getTime() + (7 * 60 * 60 * 1000)); // +7 hours
                const key = thaiTime.toISOString().slice(0, 7); // YYYY-MM
                const label = thaiTime.toLocaleDateString('th-TH', {
                    month: 'short',
                    year: '2-digit'
                });

                if (!groupedData.has(key)) {
                    groupedData.set(key, {
                        monthLabel: label,
                        received: 0,
                        used: 0,
                        sortKey: key
                    });
                }

                const current = groupedData.get(key)!;
                if (t.type === 'ADD') {
                    current.received += t.quantity_change;
                } else if (t.type === 'REMOVE') {
                    current.used += t.quantity_change;
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

    // Fix typing: ChartDataset<'bar', number[]> (NOT number) -- remove "as" casts
    const data: ChartData<'bar', number[], string> = {
        labels: chartData.map(d => d.monthLabel),
        datasets: [
            {
                label: 'ยอดรับเข้า (เพิ่ม)',
                data: chartData.map(d => d.received),
                backgroundColor: 'rgba(34, 197, 94, 0.8)',
                borderColor: '#16a34a',
                borderWidth: 1,
                borderRadius: 4,
                barPercentage: 0.6,
                categoryPercentage: 0.8,
                datalabels: {
                    anchor: 'end',
                    align: 'start' as const,
                    color: '#16a34a',
                    font: { family: "'Kanit', sans-serif", size: 13, weight: 'bold' },
                    formatter: (value: any) => value > 0 ? value : '',
                },
            } as ChartDataset<'bar', number[]>,
            {
                label: 'ยอดเบิกใช้ (ลด)',
                data: chartData.map(d => d.used),
                backgroundColor: 'rgba(239, 68, 68, 0.8)',
                borderColor: '#dc2626',
                borderWidth: 1,
                borderRadius: 4,
                barPercentage: 0.6,
                categoryPercentage: 0.8,
                datalabels: {
                    anchor: 'end',
                    align: 'end' as const,
                    color: '#dc2626',
                    font: { family: "'Kanit', sans-serif", size: 13, weight: 'bold' },
                    formatter: (value: any) => value > 0 ? value : '',
                },
            } as ChartDataset<'bar', number[]>,
        ],
    };

    const options: ChartOptions<'bar'> = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'top',
                align: 'end',
                labels: {
                    font: { family: "'Kanit', sans-serif", size: 12 },
                    usePointStyle: true,
                    boxWidth: 8,
                }
            },
            tooltip: {
                backgroundColor: 'rgba(255, 255, 255, 0.9)',
                titleColor: '#1f2937',
                bodyColor: '#1f2937',
                borderColor: '#e5e7eb',
                borderWidth: 1,
                titleFont: { family: "'Kanit', sans-serif", size: 14 },
                bodyFont: { family: "'Kanit', sans-serif", size: 13 },
                callbacks: {
                    label: function(context: any) {
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        if (context.parsed.y !== null) {
                            label += context.parsed.y + ' หน่วย';
                        }
                        return label;
                    }
                }
            },
            datalabels: {
                display: true,
                clamp: true,
            }
        },
        scales: {
            y: {
                beginAtZero: true,
                grid: {
                    color: '#f3f4f6',
                },
                ticks: {
                    font: { family: "'Kanit', sans-serif" }
                }
            },
            x: {
                grid: {
                    display: false
                },
                ticks: {
                    font: { family: "'Kanit', sans-serif" }
                }
            }
        },
        interaction: {
            mode: 'index',
            intersect: false,
        },
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
        <div className="w-full h-[350px]"> {/* กำหนดความสูงให้กราฟ */}
            <Bar options={options} data={data} plugins={[ChartDataLabels]} />
        </div>
    );
};

export default MonthlyChart;