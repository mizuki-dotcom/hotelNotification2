const { TwitterApi } = require("twitter-api-v2");
const axios = require("axios");
const Holidays = require("japanese-holidays"); // 日本の祝日判定ライブラリ
require("dotenv").config();

// 実行中に発生したエラーを蓄積する配列
const __errors = [];

// 環境変数から基本情報を取得
const {
  RAKUTEN_API_KEY,
  RAKUTEN_ACCESS_KEY,
  LINE_NOTIFY_TOKEN,
  HOTEL_ID,
  RAKUTEN_AFFILIATE_ID,
} = process.env;

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

// 祝日かどうかを判定する関数
const isHoliday = (date) => {
  return Holidays.isHoliday(date);
};

// 2日連続する祝日の1日目かどうかを判定
const isFirstOfConsecutiveHolidays = (date) => {
  if (!isHoliday(date)) return false; // 祝日でない場合は除外
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  return isHoliday(nextDay); // 翌日も祝日なら対象
};

// 指定条件でチェックイン日を判定する
const shouldIncludeCheckin = (date) => {
  const dayOfWeek = date.getDay(); // 0:日, 1:月, ..., 6:土

  if (dayOfWeek === 6) {
    return true; // 土曜日
  }
  if (dayOfWeek === 5 && isHoliday(date)) {
    return true; // 金曜日が祝日
  }
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);
  if (dayOfWeek === 0 && isHoliday(nextDay)) {
    return true; // 月曜日が祝日なら前日の日曜日
  }
  if (isFirstOfConsecutiveHolidays(date)) {
    return true; // 2日連続する祝日の1日目
  }
  return false;
};

// 条件を満たすチェックイン日を取得
const getDatesInRange = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dates = [];

  while (start <= end) {
    const checkin = new Date(start);
    if (shouldIncludeCheckin(checkin)) {
      const checkout = new Date(start);
      checkout.setDate(checkin.getDate() + 1);

      console.log(checkin.toISOString().split("T")[0]);
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
  const { checkinDate, checkoutDate } = dates.shift();

  try {
    const response = await axios.get(
      "https://openapi.rakuten.co.jp/engine/api/Travel/VacantHotelSearch/20170426",
      {
        headers: {
          Referer: "https://mura-shin.com/",
          Origin: "https://mura-shin.com/",
        },
        params: {
          applicationId: RAKUTEN_API_KEY,
          accessKey: RAKUTEN_ACCESS_KEY,
          affiliateId: RAKUTEN_AFFILIATE_ID,
          hotelNo: HOTEL_ID,
          checkinDate,
          checkoutDate,
          adultNum: 2,
          format: "json",
        },
      },
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

      await sendTwitterNotification(message, checkinDate);
    }
  } catch (error) {
    // 404 は完全に無視（記録もしない）、それ以外は記録してログ出力
    if (error?.response?.status !== 404) {
      __errors.push({ checkinDate, error: error?.toString() || error });
      console.error(`エラーが発生しました (チェックイン: ${checkinDate}):`, error);
    }
  }

    if (dates.length > 0) {
      setTimeout(checkAvailability, 1000); // 1秒遅らせる
    } else {
      // 全ての処理が終わったタイミングでエラーが一度でも発生していれば例外を投げる
      if (__errors.length > 0) {
        const messages = __errors
          .map((e) => `チェックイン:${e.checkinDate} -> ${e.error}`)
          .join("\n");
        throw new Error(`処理中にエラーが発生しました:\n${messages}`);
      }
    }
};

const sendTwitterNotification = async (message, checkinDate) => {
  try {
    await twitterClient.v2.tweet(message);
  } catch (error) {
    // エラーを記録しつつログを出す
    __errors.push({ checkinDate, error: error?.toString() || error });
    console.error("tweet中にエラーが発生しました:", error);
    if (checkinDate) console.error(`チェックイン: ${checkinDate}`);
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
