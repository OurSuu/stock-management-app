import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";

// summary per product (และเอา unit มาด้วย)
type ProductSummary = {
  name: string;
  unit: string;
  received: number;
  used: number;
  remaining: number;
  category?: string;
};

const BranchDetailModal: React.FC<{
  branchId: string;
  branchName: string;
  onClose: () => void;
}> = ({ branchId, branchName, onClose }) => {
  // สรุปยอดรวมสาขานี้ (ยอดรับเข้า/เบิก/สินค้าทั้งหมด)
  const [branchTotal, setBranchTotal] = useState<{
    in_count: number;
    out_count: number;
    stock_count: number;
    net_count: number;
  }>({ in_count: 0, out_count: 0, stock_count: 0, net_count: 0 });

  // รายการคงเหลือใน stock ทุก product
  const [stock, setStock] = useState<any[]>([]);
  // ประวัติ transaction งวดนี้
  const [transactions, setTransactions] = useState<any[]>([]);

  // summary วันนี้
  const [todaySummary, setTodaySummary] = useState<ProductSummary[]>([]);
  // summary เดือนนี้
  const [monthSummary, setMonthSummary] = useState<ProductSummary[]>([]);

  // แบ่งกลุ่มราย summary วันนี้/เดือน ตาม category
  const todaySummaryByCategory = React.useMemo(() => {
    const grouped: Record<string, ProductSummary[]> = {};
    todaySummary.forEach((item: ProductSummary) => {
      const cat = item.category || "ไม่มีหมวดหมู่";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    });
    return grouped;
  }, [todaySummary]);
  const monthSummaryByCategory = React.useMemo(() => {
    const grouped: Record<string, ProductSummary[]> = {};
    monthSummary.forEach((item: ProductSummary) => {
      const cat = item.category || "ไม่มีหมวดหมู่";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    });
    return grouped;
  }, [monthSummary]);

  const [delivering, setDelivering] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<"summary" | "stock" | "history">("summary");
  const [search, setSearch] = useState("");

  // === UTIL: แปลงเวลาจาก UTC เป็นเวลาไทย (+7 ชั่วโมง) ===
  function toThaiTime(date: Date | string): Date {
    // If the input is string, parse it to Date
    const d = typeof date === "string" ? new Date(date) : new Date(date.getTime());
    // Add 7 hours (25200000 ms)
    return new Date(d.getTime() + 7 * 60 * 60 * 1000);
  }

  // ดึงค่าปัจจุบันของประเทศไทย
  function getCurrentThaiDate() {
    // getTimeZoneOffset เอาเป็น Asia/Bangkok อย่างเดียว
    // เดือนกับวันจะไม่เคลื่อนไปวันใหม่เร็วกว่าไทย
    const now = new Date();
    // ให้ force เป็นเวลาตามเอเชีย/บางกอก โดยอ่าน string
    // ใช้ same day as shown in th-TH
    const options: Intl.DateTimeFormatOptions = {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    };
    const localeStr = now.toLocaleDateString("en-CA", options); // 'YYYY-MM-DD'
    return {
      dateObj: new Date(
        now.toLocaleString("en-US", { timeZone: "Asia/Bangkok" })
      ),
      dateStr: localeStr,
    };
  }

  // utils วัน/เวลา ไทย
  const toThaiDate = (d: string | Date) =>
    new Date(d).toLocaleDateString("th-TH", { timeZone: "Asia/Bangkok" });

  // เวลาไทย: +7 ชั่วโมง
  const toThaiDateTime = (d: string | Date) => {
    const dt = toThaiTime(d);
    return dt.toLocaleTimeString("th-TH", {
      hour: "2-digit",
      minute: "2-digit",
      // second: "2-digit", // แสดงเป็น 02:13, ไม่แสดงวินาที
      hour12: false,
    });
  };

  const toThaiDateDayFull = (d: string | Date) =>
    new Date(d).toLocaleDateString("th-TH", {
      timeZone: "Asia/Bangkok",
      weekday: "long",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

  // ดึงข้อมูล - เหมือนหน้า BranchStock แยกทีละสาขา
  const fetchData = useCallback(async () => {
    setIsLoading(true);

    // STOCK - ขอ category ของสินค้าเพิ่มด้วย
    const { data: stockData } = await supabase
      .from("stock")
      .select("current_quantity, products(name, unit, category)")
      .eq("branch_id", branchId);

    // map for category lookup
    const nameToCategory = new Map<string, string>();
    stockData?.forEach((item: any) => {
      const name = item.products?.name || "";
      nameToCategory.set(name, item.products?.category || "ไม่มีหมวดหมู่");
    });

    const remainingMap = new Map<string, { unit: string; remaining: number }>();
    let stockCount = 0;
    stockData?.forEach((item: any) => {
      const name = item.products?.name || "";
      remainingMap.set(name, { unit: item.products?.unit || "", remaining: item.current_quantity ?? 0 });
      stockCount += 1;
    });

    // TRANSACTIONS (ย้อนไป 60 วัน, ส่วนใหญ่ของ branch น้อยกว่า)
    const searchFromDate = new Date();
    searchFromDate.setDate(searchFromDate.getDate() - 60);

    const { data: txnData } = await supabase
      .from("transactions")
      .select("*, products(name, unit, category)")
      .eq("branch_id", branchId)
      .gte("created_at", searchFromDate.toISOString())
      .order("created_at", { ascending: false });

    // SUMMARY: ใช้เวลา Asia/Bangkok ในการอ้างอิง (ไม่บวก 7 ชั่วโมงเอง)
    const { dateObj: nowTH, dateStr: todayStr } = getCurrentThaiDate();
    const currentMonthStr = nowTH.toLocaleDateString("en-CA", {
      timeZone: "Asia/Bangkok",
      year: "numeric",
      month: "2-digit",
    });

    // สรุปยอด "รับ" "ใช้" รายวัน/เดือน
    // category+name แยก
    const todayMap = new Map<string, ProductSummary>();
    const todayCategoryMap = new Map<string, string>(); // name: category
    const monthMap = new Map<string, ProductSummary>();
    const monthCategoryMap = new Map<string, string>();

    const psInit = (name: string, unit: string, category?: string) => ({
      name,
      unit,
      received: 0,
      used: 0,
      remaining: remainingMap.get(name)?.remaining ?? 0,
      category: category || nameToCategory.get(name) || "ไม่มีหมวดหมู่"
    });

    let in_count = 0;
    let out_count = 0;
    txnData?.forEach((t: any) => {
      const prodName = t.products?.name || "สินค้าไม่ระบุ";
      const unit = t.products?.unit || "";
      const qty = Number(t.quantity_change) || 0;
      const type = t.type;
      const category = t.products?.category || nameToCategory.get(prodName) || "ไม่มีหมวดหมู่";

      // === แปลง DB (supabase/UTC) -> เวลาไทย: บวก +7 ชั่วโมง
      const utcDate = new Date(t.created_at);
      const txDate = new Date(utcDate.getTime() + 7 * 60 * 60 * 1000);

      // วัน/เดือน
      const txDateStr = txDate.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
      const txMonthStr = txDate.toLocaleDateString("en-CA", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
      });

      // -- เดือน
      if (!monthMap.has(prodName)) {
        monthMap.set(prodName, psInit(prodName, unit, category));
        monthCategoryMap.set(prodName, category);
      }
      if (txMonthStr === currentMonthStr) {
        if (type === "ADD") {
          monthMap.get(prodName)!.received += qty;
          in_count += qty;
        }
        if (type === "REMOVE") {
          monthMap.get(prodName)!.used += Math.abs(qty);
          out_count += Math.abs(qty);
        }
        if (type === "RESTORE") {
          monthMap.get(prodName)!.used -= Math.abs(qty);
          out_count -= Math.abs(qty);
        }
      }

      // -- วันนี้
      if (!todayMap.has(prodName)) {
        todayMap.set(prodName, psInit(prodName, unit, category));
        todayCategoryMap.set(prodName, category);
      }
      if (txDateStr === todayStr) {
        if (type === "ADD") {
          todayMap.get(prodName)!.received += qty;
        }
        if (type === "REMOVE") {
          todayMap.get(prodName)!.used += Math.abs(qty);
        }
        if (type === "RESTORE") {
          todayMap.get(prodName)!.used -= Math.abs(qty);
        }
      }
    });

    // DELIVERY กำลังส่ง
    const { data: delivers } = await supabase
      .from("orders")
      .select("id, status, delivery_date, approved_by, order_items(quantity)")
      .eq("branch_id", branchId)
      .eq("status", "IN_TRANSIT");

    setStock(stockData || []);
    setTransactions(txnData || []);
    // add category for summary
    setTodaySummary(Array.from(todayMap.values()).map(item => ({
      ...item,
      category: todayCategoryMap.get(item.name) || item.category || "ไม่มีหมวดหมู่"
    })));
    setMonthSummary(Array.from(monthMap.values()).map(item => ({
      ...item,
      category: monthCategoryMap.get(item.name) || item.category || "ไม่มีหมวดหมู่"
    })));
    setBranchTotal({
      in_count,
      out_count: out_count < 0 ? 0 : out_count,
      net_count: in_count - (out_count < 0 ? 0 : out_count),
      stock_count: stockCount,
    });
    setDelivering(delivers || []);
    setIsLoading(false);
  }, [branchId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ประวัติรายการ ค้นหาตามสินค้า/คนทำ
  const filteredTx = transactions.filter(
    (t) =>
      t.products?.name?.toLowerCase().includes(search.toLowerCase()) ||
      t.performed_by?.toLowerCase().includes(search.toLowerCase())
  );

  // === Group stock by category ===
  const categoryGroupedStock = React.useMemo(() => {
    // category: string => stock[]
    const grouped: Record<string, any[]> = {};
    stock.forEach((item: any) => {
      const cat = item.products?.category || "ไม่มีหมวดหมู่";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(item);
    });
    return grouped;
  }, [stock]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
        onClick={onClose}
      ></div>
      <div className="bg-white w-full max-w-4xl rounded-[2rem] shadow-2xl overflow-hidden relative z-10 flex flex-col max-h-[90vh] animate-slide-up">
        {/* Header */}
        <div className="bg-white border-b border-slate-100 p-6 flex justify-between items-center shrink-0">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">{branchName}</h2>
            <p className="text-sm text-slate-500">รหัสสาขา: #{branchId.substring(0, 6)}</p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-full bg-slate-50 hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800 text-xl"
          >
            ✕
          </button>
        </div>

        {/* Alert ของกำลังส่ง */}
        {delivering.length > 0 && (
          <div className="bg-green-50 border-b border-green-100 p-3 flex items-center gap-3 px-6 animate-pulse">
            <span className="text-2xl">🚚</span>
            <div>
              <p className="text-green-800 font-bold text-sm">มีสินค้ากำลังจัดส่งมายังสาขานี้</p>
              <p className="text-green-600 text-xs">
                จำนวน {delivering.length} ออเดอร์ (รอสาขากดรับของ)
              </p>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto bg-slate-50 p-6">
          <div className="flex space-x-2 mb-6 bg-white p-1.5 rounded-xl shadow-sm w-fit mx-auto overflow-x-auto max-w-full">
            <button
              className={`px-5 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${
                tab === "summary"
                  ? "bg-indigo-700 text-white shadow-md"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
              onClick={() => setTab("summary")}
            >
              📊 ภาพรวมสาขา
            </button>
            <button
              className={`px-5 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${
                tab === "stock"
                  ? "bg-indigo-600 text-white shadow-md"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
              onClick={() => setTab("stock")}
            >
              📦 สต็อกสินค้า
            </button>
            <button
              className={`px-5 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-all ${
                tab === "history"
                  ? "bg-indigo-600 text-white shadow-md"
                  : "text-slate-500 hover:bg-slate-50"
              }`}
              onClick={() => setTab("history")}
            >
              📜 ประวัติการเปลี่ยนแปลง
            </button>
          </div>

          {isLoading ? (
            <div className="py-16 text-center">
              <div className="animate-spin h-10 w-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full mx-auto"></div>
            </div>
          ) : (
            <>
              {/* SUMMARY TAB */}
              {tab === "summary" && (
                <div className="space-y-8">
                  {/* รวมยอดรวม */}
                  <div className="bg-white rounded-2xl shadow-sm border border-indigo-200 overflow-hidden p-0 md:p-0">
                    <div className="bg-indigo-600 px-8 py-5">
                      <h3 className="font-bold text-lg text-white flex items-center gap-2">
                        🏪 ภาพรวมสาขา
                        <span className="text-xs bg-white/20 text-white px-2 py-0.5 rounded font-mono font-normal">
                          {toThaiDateDayFull(
                            new Date(
                              new Date().toLocaleString("en-US", {
                                timeZone: "Asia/Bangkok",
                              })
                            )
                          )}
                        </span>
                      </h3>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6 p-8 bg-white">
                      <div className="flex flex-col items-center gap-2">
                        <div className="rounded-full bg-green-100 p-3 text-green-700 text-xl">📥</div>
                        <span className="text-xs text-slate-500">รับเข้า (เดือนนี้)</span>
                        <span className="font-bold text-lg text-green-800 font-mono">
                          +{branchTotal.in_count}
                        </span>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <div className="rounded-full bg-red-100 p-3 text-red-600 text-xl">📤</div>
                        <span className="text-xs text-slate-500">เบิกออก (เดือนนี้)</span>
                        <span className="font-bold text-lg text-red-700 font-mono">
                          -{branchTotal.out_count}
                        </span>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <div className="rounded-full bg-indigo-100 p-3 text-indigo-700 text-xl">📊</div>
                        <span className="text-xs text-slate-500">สุทธิทั้งเดือน</span>
                        <span
                          className={`font-bold text-lg font-mono ${
                            branchTotal.net_count >= 0 ? "text-green-700" : "text-red-700"
                          }`}
                        >
                          {branchTotal.net_count >= 0 ? "+" : "-"}
                          {Math.abs(branchTotal.net_count)}
                        </span>
                      </div>
                      <div className="flex flex-col items-center gap-2">
                        <div className="rounded-full bg-yellow-100 p-3 text-yellow-700 text-xl">🗃️</div>
                        <span className="text-xs text-slate-500">จำนวนสินค้า</span>
                        <span className="font-bold text-lg text-slate-800">
                          {branchTotal.stock_count}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* รายละเอียดสรุปสินค้าแยกรายวัน/เดือน (สอง column, แต่แต่ละกลุ่มมีแยกหมวดหมู่ย่อย) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* SUMMARY TODAY */}
                    <div className="bg-white rounded-2xl shadow-sm border border-indigo-100 overflow-hidden">
                      <div className="bg-indigo-50 p-4 border-b border-indigo-100 flex items-center justify-between">
                        <h3 className="font-bold text-indigo-700">
                          📅 วันนี้ (
                          {toThaiDate(
                            new Date(
                              new Date().toLocaleString("en-US", {
                                timeZone: "Asia/Bangkok",
                              })
                            )
                          )}
                          )
                        </h3>
                      </div>
                      <div className="p-4">
                        {Object.keys(todaySummaryByCategory).length === 0 ? (
                          <div className="text-center text-slate-400 py-6">
                            วันนี้ยังไม่มีการเปลี่ยนแปลง
                          </div>
                        ) : (
                          <div className="flex flex-col gap-4">
                            {Object.entries(todaySummaryByCategory).map(([category, items]) => (
                              <div key={category} className="">
                                <div className="font-bold text-indigo-600 text-sm mb-2">{category}</div>
                                <ul className="space-y-3">
                                  {items.map((item, idx) => (
                                    <li key={idx} className="flex justify-between items-center border-b border-slate-50 pb-2 last:border-0 hover:bg-slate-50 transition px-2 rounded-lg">
                                      <div className="flex flex-col">
                                        <span className="text-slate-700 font-bold">
                                          {item.name}
                                        </span>
                                        <span className="text-xs text-slate-400 font-light">
                                          หน่วย: {item.unit}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <div className="flex flex-col items-end mr-2 border-r border-slate-200 pr-3">
                                          <span className="text-[10px] text-slate-400 uppercase tracking-wider">คงเหลือ</span>
                                          <span className="font-mono text-lg font-bold text-slate-700">
                                            {item.remaining}
                                          </span>
                                        </div>
                                        <div className="flex flex-col gap-1 min-w-[70px]">
                                          <div className={`flex items-center justify-between px-2 py-0.5 rounded-md text-xs font-bold ${
                                            item.received > 0 ? "bg-green-100 text-green-700" : "opacity-0"
                                          }`}>
                                            <span>รับ</span>
                                            <span>+{item.received}</span>
                                          </div>
                                          <div className={`flex items-center justify-between px-2 py-0.5 rounded-md text-xs font-bold ${
                                            item.used > 0 ? "bg-red-100 text-red-700" : "opacity-0"
                                          }`}>
                                            <span>ใช้</span>
                                            <span>-{item.used}</span>
                                          </div>
                                        </div>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                    {/* SUMMARY MONTH */}
                    <div className="bg-white rounded-2xl shadow-sm border border-orange-100 overflow-hidden">
                      <div className="bg-orange-50 p-4 border-b border-orange-100 flex items-center justify-between">
                        <h3 className="font-bold text-orange-700">🗓️ เดือนนี้</h3>
                      </div>
                      <div className="p-4">
                        {Object.keys(monthSummaryByCategory).length === 0 ? (
                          <div className="text-center text-slate-400 py-6">
                            เดือนนี้ยังไม่มีข้อมูล
                          </div>
                        ) : (
                          <div className="flex flex-col gap-4">
                            {Object.entries(monthSummaryByCategory).map(([category, items]) => (
                              <div key={category} className="">
                                <div className="font-bold text-orange-600 text-sm mb-2">{category}</div>
                                <ul className="space-y-3">
                                  {items.map((item, idx) => (
                                    <li key={idx} className="flex justify-between items-center border-b border-slate-50 pb-2 last:border-0 hover:bg-slate-50 transition px-2 rounded-lg">
                                      <div className="flex flex-col">
                                        <span className="text-slate-700 font-bold">
                                          {item.name}
                                        </span>
                                        <span className="text-xs text-slate-400 font-light">
                                          หน่วย: {item.unit}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-3">
                                        <div className="flex flex-col items-end mr-2 border-r border-slate-200 pr-3">
                                          <span className="text-[10px] text-slate-400 uppercase tracking-wider">คงเหลือ</span>
                                          <span className="font-mono text-lg font-bold text-slate-700">
                                            {item.remaining}
                                          </span>
                                        </div>
                                        <div className="flex flex-col gap-1 min-w-[70px]">
                                          <div className={`flex items-center justify-between px-2 py-0.5 rounded-md text-xs font-bold ${
                                            item.received > 0 ? "bg-green-100 text-green-700" : "opacity-0"
                                          }`}>
                                            <span>รับ</span>
                                            <span>+{item.received}</span>
                                          </div>
                                          <div className={`flex items-center justify-between px-2 py-0.5 rounded-md text-xs font-bold ${
                                            item.used > 0 ? "bg-red-100 text-red-700" : "opacity-0"
                                          }`}>
                                            <span>ใช้</span>
                                            <span>-{item.used}</span>
                                          </div>
                                        </div>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* STOCK TAB */}
              {tab === "stock" && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                  {/* กลุ่มสินค้าตามหมวดหมู่ */}
                  {Object.keys(categoryGroupedStock).length === 0 ? (
                    <div className="p-6 text-center text-slate-400">
                      ไม่มีข้อมูล
                    </div>
                  ) : (
                    Object.entries(categoryGroupedStock).map(
                      ([category, items]: [string, any[]], catIdx) => (
                        <div key={catIdx} className="mb-6 border-b last:border-0 border-slate-100">
                          <div className="px-6 py-3 bg-slate-50 font-bold text-indigo-700 rounded-t-md flex items-center">
                            <span className="text-base">{category}</span>
                          </div>
                          <table className="w-full">
                            <thead className="bg-white text-slate-500 text-xs uppercase">
                              <tr>
                                <th className="px-6 py-3 text-left">สินค้า</th>
                                <th className="px-6 py-3 text-right">คงเหลือ</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                              {items.map((item: any, idx) => (
                                <tr key={idx}>
                                  <td className="px-6 py-4 font-medium text-slate-800">{item.products?.name}</td>
                                  <td className="px-6 py-4 text-right font-bold text-slate-700">
                                    {item.current_quantity} {item.products?.unit}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    )
                  )}
                </div>
              )}

              {/* HISTORY TAB */}
              {tab === "history" && (
                <div className="space-y-4">
                  {/* Search Bar */}
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="🔍 ค้นหาชื่อสินค้า หรือ ผู้ทำรายการ..."
                      className="w-full p-3 pl-10 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-sm"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                    <span className="absolute left-3 top-3.5 text-slate-400">📜</span>
                  </div>
                  {filteredTx.length === 0 ? (
                    <div className="text-center py-10 text-slate-400 bg-white rounded-2xl border border-dashed border-slate-200">
                      {search ? "ไม่พบรายการที่ค้นหา" : "ไม่พบประวัติรายการ"}
                    </div>
                  ) : (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                      <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                        {filteredTx.map((txn: any) => (
                          <div
                            key={txn.id}
                            className="flex justify-between items-center p-4 border-b border-slate-50 last:border-0 hover:bg-slate-50 transition"
                          >
                            <div className="flex items-center gap-3">
                              <div
                                className={`w-10 h-10 rounded-full flex items-center justify-center text-lg ${
                                  txn.type === "ADD"
                                    ? "bg-green-100 text-green-600"
                                    : txn.type === "REMOVE"
                                    ? "bg-red-100 text-red-600"
                                    : "bg-blue-100 text-blue-600"
                                }`}
                              >
                                {txn.type === "ADD"
                                  ? "📥"
                                  : txn.type === "REMOVE"
                                  ? "📤"
                                  : "↩️"}
                              </div>
                              <div>
                                <p className="font-bold text-slate-700 text-sm">
                                  {txn.type === "ADD"
                                    ? "รับของเข้า"
                                    : txn.type === "REMOVE"
                                    ? "เบิกของออก"
                                    : "กู้คืนรายการ"}
                                  <span className="ml-2 text-indigo-600 font-bold">
                                    {txn.products?.name}
                                  </span>
                                </p>
                                <div className="flex gap-2 text-xs text-slate-400 mt-0.5">
                                  <span>📅 {toThaiDate(txn.created_at)}</span>
                                  <span>🕒 {toThaiDateTime(txn.created_at)}</span>
                                  <span>👤 {txn.performed_by}</span>
                                </div>
                              </div>
                            </div>
                            <span
                              className={`font-bold font-mono text-lg ${
                                txn.type === "ADD" || txn.type === "RESTORE"
                                  ? "text-green-600"
                                  : "text-red-600"
                              }`}
                            >
                              {(txn.type === "ADD" || txn.type === "RESTORE" ? "+" : "-")}
                              {txn.quantity_change} {txn.products?.unit}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 bg-white border-t border-slate-100 flex justify-end shrink-0">
          <button
            className="px-6 py-2.5 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition w-full sm:w-auto"
            onClick={onClose}
          >
            ปิดหน้าต่าง
          </button>
        </div>
      </div>
    </div>
  );
};

export default BranchDetailModal;