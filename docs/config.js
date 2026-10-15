// Supabase 連線設定。兩個都填才會把練習紀錄存到線上資料庫；留空就存在學生裝置的瀏覽器。
// 在 Supabase 專案的 Project Settings → API 取得：
//   SUPABASE_URL       Project URL，例如 https://abcdefgh.supabase.co
//   SUPABASE_ANON_KEY  anon / publishable 金鑰（會公開在網頁裡，這是正常的；
//                      資料表都鎖著，只能透過 supabase/schema.sql 裡的函式存取）
// ⚠️ 千萬不要填 service_role / secret 金鑰。
export const SUPABASE_URL = "";
export const SUPABASE_ANON_KEY = "";
