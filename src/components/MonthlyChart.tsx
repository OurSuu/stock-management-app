import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
// 1. นำเข้า Chart Components และ Type
import { Line } from 'react-chartjs-2';
import { 
  Chart as ChartJS, 
  CategoryScale, 
  LinearScale, 
  PointElement, 
  LineElement, 
  Title, 
  Tooltip, 
  Legend 
} from 'chart.js';

// 2. ลงทะเบียน Chart.js Components ที่จำเป็น
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

// 3. กำหนด Type สำหรับข้อมูลที่จัดเตรียมแล้ว
type ChartDataPoint = {
    monthLabel: string; // เช่น 'Nov 2025'
    netChange: number; // ผลรวมของ ADD - REMOVE
};

// 4. ฟังก์ชันหลักในการดึงและจัดเตรียมข้อมูล
const fetchDataAndTransform = async (productId?: string) => {
    // Note: Supabase Query สามารถดึงข้อมูลดิบเท่านั้น 
    // เราจึงต้องประมวลผลการจัดกลุ่ม (Group by) และผลรวม (SUM) ที่ฝั่ง Client

    const { data: transactions, error } = await supabase
        .from('transactions')
        .select(`
            created_at, 
            type, 
            quantity_change
        `)
        // กรองเฉพาะการทำรายการ 12 เดือนล่าสุด (ถ้ามีเวลา)
        .order('created_at', { ascending: true }); 

    if (error) {
        console.error('Error fetching transactions:', error);
        return [];
    }

    // 5. การจัดเตรียมและรวมข้อมูล (Data Transformation)
    const monthlyDataMap = new Map<string, number>();

    transactions.forEach(t => {
        const date = new Date(t.created_at);
        // สร้าง Key สำหรับจัดกลุ่มรายเดือน (YYYY-MM)
        const monthKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
        // สร้าง Label ที่อ่านง่ายสำหรับแสดงบนกราฟ
        const monthLabel = date.toLocaleString('th-TH', { month: 'short', year: '2-digit' });
        
        let change = 0;
        if (t.type === 'ADD') {
            change = t.quantity_change;
        } else if (t.type === 'REMOVE') {
            change = -t.quantity_change; // การเบิกใช้คือค่าติดลบ
        }

        // รวมค่า netChange (ADD - REMOVE) ในเดือนนั้นๆ
        const currentNet = monthlyDataMap.get(monthKey) || 0;
        monthlyDataMap.set(monthKey, currentNet + change);
    });

    // 6. แปลง Map เป็น Array และจัดเรียงตาม Key (YYYY-MM)
    const sortedKeys = Array.from(monthlyDataMap.keys()).sort();

    const result: ChartDataPoint[] = sortedKeys.map(key => {
        const [year, month] = key.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1);
        const monthLabel = date.toLocaleString('th-TH', { month: 'short', year: '2-digit' });
        
        return {
            monthLabel: monthLabel,
            netChange: monthlyDataMap.get(key) || 0,
        };
    });

    // แสดงเฉพาะ 12 เดือนล่าสุด (Optional)
    return result.slice(-12);
};

// 7. Component หลัก
const MonthlyChart: React.FC = () => {
    const [chartData, setChartData] = useState<ChartDataPoint[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadData = async () => {
            setIsLoading(true);
            const data = await fetchDataAndTransform();
            setChartData(data);
            setIsLoading(false);
        };
        loadData();
    }, []);

    // 8. การจัดโครงสร้างข้อมูลให้ Chart.js
    const dataForChart = {
        labels: chartData.map(d => d.monthLabel),
        datasets: [
            {
                label: 'ยอดเปลี่ยนแปลงสุทธิ (หน่วยรวม)',
                data: chartData.map(d => d.netChange),
                borderColor: 'rgb(79, 70, 229)', // indigo-600
                backgroundColor: 'rgba(79, 70, 229, 0.5)',
                tension: 0.4, // ทำให้กราฟดูโค้งมน
            },
        ],
    };

    // 9. ตัวเลือกของกราฟ
    const options = {
        responsive: true,
        plugins: {
            legend: {
                position: 'top' as const,
            },
            title: {
                display: true,
                text: 'ยอดเปลี่ยนแปลงสต็อกสุทธิ 12 เดือนล่าสุด (รวมทุกสาขา)',
            },
        },
        scales: {
            y: {
                title: {
                    display: true,
                    text: 'ปริมาณสินค้า (หน่วย)',
                }
            }
        }
    };

    if (isLoading) return <div className="text-center p-8 text-gray-500">กำลังโหลดข้อมูลกราฟ...</div>;
    if (chartData.length === 0) return <div className="text-center p-8 text-gray-500">ไม่พบข้อมูลการทำรายการในระบบ</div>;

    return (
        <div className="w-full h-96">
            <Line options={options} data={dataForChart} />
        </div>
    );
};

export default MonthlyChart;