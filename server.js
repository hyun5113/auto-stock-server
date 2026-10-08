const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 데이터베이스 역할을 할 JSON 파일 경로
const HISTORY_FILE = path.join(__dirname, 'history.json');

// --- [신규 기능] 서버가 켜질 때 과거 데이터가 없으면 가짜 15일치 데이터 생성 ---
function initializeDummyHistory() {
  if (!fs.existsSync(HISTORY_FILE)) {
    console.log("📊 기록 파일이 없어 최근 15일치 테스트 데이터를 자동 생성합니다...");
    const dummyData = [];
    let baseTotal = 11000000; // 1,100만원 기준
    
    for (let i = 15; i >= 1; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      
      // 매일 -1% ~ +2% 랜덤 변동
      const changeRate = (Math.random() * 0.03) - 0.01; 
      baseTotal = Math.round(baseTotal * (1 + changeRate));
      
      dummyData.push({
        date: dateStr,
        totalKrw: baseTotal,
        note: "자동 생성된 테스트 기록"
      });
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(dummyData, null, 2));
  }
}
initializeDummyHistory();

// --- 1. 과거 기록(History) 불러오기 API ---
app.get('/api/history', (req, res) => {
  try {
    const data = fs.readFileSync(HISTORY_FILE, 'utf8');
    res.json({ success: true, data: JSON.parse(data) });
  } catch (error) {
    res.status(500).json({ success: false, message: '기록을 불러오지 못했습니다.' });
  }
});

// --- 2. 오늘자 스냅샷(History) 저장하기 API ---
app.post('/api/history', (req, res) => {
  try {
    const { date, totalKrw } = req.body;
    let history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
    
    // 이미 오늘 날짜 기록이 있는지 확인 (있으면 덮어쓰기, 없으면 추가)
    const existingIndex = history.findIndex(h => h.date === date);
    if (existingIndex >= 0) {
      history[existingIndex] = { date, totalKrw, note: "업데이트됨" };
    } else {
      history.push({ date, totalKrw, note: "자동 스냅샷" });
    }

    // 날짜순 정렬 후 저장
    history.sort((a, b) => new Date(a.date) - new Date(b.date));
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
    
    console.log(`✅ [기록 완료] ${date} 기준 총자산 ${totalKrw.toLocaleString()}원 스냅샷 저장!`);
    res.json({ success: true });
  } catch (error) {
    console.error("저장 에러:", error);
    res.status(500).json({ success: false, message: '저장 실패' });
  }
});


// --- 3. 토스 API 잔고 연동 (기존과 동일, 완벽 버전) ---
app.get('/api/sync-toss', async (req, res) => {
  console.log("-----------------------------------------");
  console.log(`🌐 [백엔드] 웹 화면에서 토스 잔고 갱신 요청이 들어왔습니다.`);
  
  const clientId = process.env.TOSS_CLIENT_ID;
  const clientSecret = process.env.TOSS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return res.status(400).json({ success: false, message: '.env 파일에 API 키가 없습니다.' });
  }

  try {
    // 1. 토큰 발급
    console.log("🔑 1단계: 토큰 발급 요청...");
    const tokenRes = await axios.post('https://openapi.tossinvest.com/oauth2/token', 
      new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const accessToken = tokenRes.data.access_token;
    
    // 2. 계좌 목록 조회 (accountSeq 추출)
    console.log("🔍 2단계: 계좌 번호 추출...");
    const accRes = await axios.get('https://openapi.tossinvest.com/api/v1/accounts', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const accounts = accRes.data?.result || accRes.data?.items || accRes.data;
    if (!accounts || accounts.length === 0) throw new Error("조회 가능한 주식 계좌가 없습니다.");
    
    const accountSeq = accounts[0].accountSeq;
    
    // 3. 실제 잔고 조회
    console.log(`📊 3단계: 잔고 데이터 조회 중...`);
    const balanceRes = await axios.get('https://openapi.tossinvest.com/api/v1/holdings', {
      headers: { 
        Authorization: `Bearer ${accessToken}`,
        'X-Tossinvest-Account': String(accountSeq)
      }
    });
    
    console.log("✅ 잔고 조회 성공!");
    res.json({ success: true, data: balanceRes.data?.result || balanceRes.data?.items || balanceRes.data });

  } catch (error) {
    const errorMsg = error.response?.data?.error?.message || error.response?.data?.message || error.message;
    console.log("❌ [에러]", errorMsg);
    res.status(500).json({ success: false, message: errorMsg });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 AssetPulse Pro 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
