const mongoose = require('mongoose');
const CustomQuizSchema = require('./models/quiz');
const UserQuizScoreSchema = require('./models/userQuizScore');
const QuizResultSchema = require('./models/quizResult');
const HangmanScoreSchema = require('./models/hangmanScore');
const HangmanResultSchema = require('./models/hangmanResult');
const WordchainScoreSchema = require('./models/wordchainScore');
const WordchainResultSchema = require('./models/wordchainResult');
const DatingProfileSchema = require('./models/datingProfile');
const DatingLikeSchema = require('./models/datingLike');

const Invite = require('./models/invite');
const UserMap = require('./models/userMap');
const BannedUser = require('./models/banned');
const NSFWSetting = require('./models/nsfw');
const accceptMap = require('./models/accept');
const Antilink = require('./models/antilink');
const AntilinkWarning = require('./models/antilinkWarnings');
const Warning = require('./models/warning');
const BroadcastId = require('./models/broadcastId');
const CleanCommand = require('./models/cleanCommand');
const WelcomeSettings = require('./models/welcomeSettings');
const SpecialUser = require('./models/specialUser');
const Activity = require('./models/activity');
const { GlobalUserStats, GlobalGroupStats } = require('./models/globalStats');

let secondaryDb = null;
let datingDb = null;
let CustomQuizModel = null;
let UserQuizScoreModel = null;
let QuizResultModel = null;
let HangmanScoreModel = null;
let HangmanResultModel = null;
let WordchainScoreModel = null;
let WordchainResultModel = null;
let DatingProfileModel = null;
let DatingLikeModel = null;

async function connectToDatabases() {
  const MONGO_URI = process.env.mongouri;
  const SECONDARY_MONGO_URI = process.env.SECONDARY_MONGO_URI;
  const DATING_MONGO_URI = process.env.DATING_MONGO_URI;

  try {
    await mongoose.connect(MONGO_URI);
    console.log("✅ MongoDB Connected");

    if (SECONDARY_MONGO_URI) {
      secondaryDb = mongoose.createConnection(SECONDARY_MONGO_URI);

      secondaryDb.on("connected", () => console.log("✅ Secondary MongoDB Connected for Quizzes"));
      secondaryDb.on("error", (err) => console.error("❌ Secondary MongoDB Connection Error:", err));

      CustomQuizModel = secondaryDb.model("Quiz", CustomQuizSchema);
      UserQuizScoreModel = secondaryDb.model("UserQuizScore", UserQuizScoreSchema);
      QuizResultModel = secondaryDb.model("QuizResult", QuizResultSchema);
      HangmanScoreModel = secondaryDb.model("HangmanScore", HangmanScoreSchema);
      HangmanResultModel = secondaryDb.model("HangmanResult", HangmanResultSchema);
      WordchainScoreModel = secondaryDb.model("WordchainScore", WordchainScoreSchema);
      WordchainResultModel = secondaryDb.model("WordchainResult", WordchainResultSchema);
    }

    if (DATING_MONGO_URI) {
      datingDb = mongoose.createConnection(DATING_MONGO_URI);

      datingDb.on("connected", () => console.log("✅ Dating MongoDB Connected"));
      datingDb.on("error", (err) => console.error("❌ Dating MongoDB Connection Error:", err));

      DatingProfileModel = datingDb.model("DatingProfile", DatingProfileSchema);
      DatingLikeModel = datingDb.model("DatingLike", DatingLikeSchema);
    }
  } catch (err) {
    console.error("❌ MongoDB Connection Error:", err);
  }
}

module.exports = {
  connectToDatabases,
  Invite,
  UserMap,
  BannedUser,
  NSFWSetting,
  accceptMap,
  Antilink,
  AntilinkWarning,
  Warning,
  BroadcastId,
  CleanCommand,
  WelcomeSettings,
  SpecialUser, // Add SpecialUser here
  Activity,
  GlobalUserStats,
  GlobalGroupStats,
  getCustomQuizModel: () => CustomQuizModel,
  getUserQuizScoreModel: () => UserQuizScoreModel,
  getQuizResultModel: () => QuizResultModel,
  getHangmanScoreModel: () => HangmanScoreModel,
  getHangmanResultModel: () => HangmanResultModel,
  getWordchainScoreModel: () => WordchainScoreModel,
  getWordchainResultModel: () => WordchainResultModel,
  getDatingProfileModel: () => DatingProfileModel,
  getDatingLikeModel: () => DatingLikeModel
};
