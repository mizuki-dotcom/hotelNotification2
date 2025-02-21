const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const Holidays = require("japanese-holidays"); // 日本の祝日判定ライブラリ
require("dotenv").config();

// 環境変数から基本情報を取得
const { RAKUTEN_API_KEY, LINE_NOTIFY_TOKEN, HOTEL_ID, RAKUTEN_AFFILIATE_ID } =
  process.env;

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_API_KEY,
  appSecret: process.env.TWITTER_API_SECRET_KEY,
  accessToken: process.env.TWITTER_ACCESS_TOKEN,
  accessSecret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
});

// 実行日の次の日を取得
const getNextDay = () => {
  const today = new Date();
  const nextDay = new Date(today);
  nextDay.setDate(today.getDate() + 1);
  return nextDay.toISOString().split("T")[0];
};

// 開始日から4ヶ月後の日付を取得
const getThreeMonthsLater = (startDate) => {
  const start = new Date(startDate);
  const threeMonthsLater = new Date(start);
  threeMonthsLater.setMonth(start.getMonth() + 4);
  return threeMonthsLater.toISOString().split("T")[0];
};

const START_DATE = getNextDay();
const END_DATE = getThreeMonthsLater(START_DATE);

// 祝前日判定関数
const isHolidayEve = (date) => {
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  return Holidays.isHoliday(nextDay);
};

// 金曜・土曜・祝前日のみ取得する
const getDatesInRange = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dates = [];

  while (start <= end) {
    const checkin = new Date(start);
    const checkout = new Date(start);
    checkout.setDate(checkin.getDate() + 1);

    const dayOfWeek = checkin.getDay(); // 0:日, 1:月, 2:火, ..., 6:土

    if (dayOfWeek === 5 || dayOfWeek === 6 || isHolidayEve(checkin)) {
      dates.push({
        checkinDate: checkin.toISOString().split("T")[0],
        checkoutDate: checkout.toISOString().split("T")[0],
      });
    }

    start.setDate(start.getDate() + 1);
  }

  return dates;
};

const formatDate = (dateString) => {
  const date = new Date(dateString);
  const year = date.getFullYear();
  const month = ("0" + (date.getMonth() + 1)).slice(-2);
  const day = ("0" + date.getDate()).slice(-2);
  const weekDay = ["日", "月", "火", "水", "木", "金", "土"][date.getDay()];
  return `${year}/${month}/${day}(${weekDay})`;
};

const dates = getDatesInRange(START_DATE, END_DATE);

const checkAvailability = async () => {
  if (dates.length === 0) {
    return;
  }

  const { checkinDate, checkoutDate } = dates.shift();

  try {
    const response = await axios.get(
      "https://app.rakuten.co.jp/services/api/Travel/VacantHotelSearch/20170426",
      {
        params: {
          applicationId: RAKUTEN_API_KEY,
          affiliateId: RAKUTEN_AFFILIATE_ID,
          hotelNo: HOTEL_ID,
          checkinDate,
          checkoutDate,
          adultNum: 2,
        },
      }
    );

    const data = response.data;

    if (data.hotels && data.hotels.length > 0) {
      // ホテル名
      // const hotelName = data.hotels[0].hotel[0].hotelBasicInfo.hotelName;
      // ホテルURL
      const hotelURL =
        data.hotels[0].hotel[0].hotelBasicInfo.hotelInformationUrl;

      const roomName =
        data.hotels[0].hotel[1].roomInfo[0].roomBasicInfo.roomName;
      const reserveUrl =
        data.hotels[0].hotel[1].roomInfo[0].roomBasicInfo.reserveUrl;

      const message = `【空室通知】
トイストーリーホテルに空室あり！

チェックイン：${formatDate(checkinDate)} 
部屋情報　　：${truncateString(roomName)}
ホテルページ：${hotelURL}
予約ページ　：${reserveUrl}

#TDS #disney #トイストーリーホテル #pr`;

      await sendTwitterNotification(message);
    }
  } catch (error) {
    if (error?.response?.status !== 404) {
      console.error(
        `エラーが発生しました (チェックイン: ${checkinDate}):`,
        error
      );
    }
  }

  if (dates.length > 0) {
    setTimeout(checkAvailability, 1000); // 1秒遅らせる
  }
};

const sendTwitterNotification = async (message) => {
  try {
    await twitterClient.v2.tweet(message);
  } catch (error) {
    console.error("tweet中にエラーが発生しました:", error);
  }
};

const sendLineNotification = async (message) => {
  try {
    await axios.post(
      "https://notify-api.line.me/api/notify",
      new URLSearchParams({ message }),
      {
        headers: {
          Authorization: `Bearer ${LINE_NOTIFY_TOKEN}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
      }
    );
  } catch (error) {
    console.error("LINE通知の送信中にエラーが発生しました:", error);
  }
};

function truncateString(str) {
  // 文字列が13文字以上の場合、12文字に切り取って"..."を追加
  if (str.length > 12) {
    return str.slice(0, 12) + "...";
  }
  return str;
}

// スクリプトの実行
checkAvailability();
