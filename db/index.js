const mongoose = require('mongoose');
const CustomQuizSchema = require('./models/quiz');
const UserQuizScoreSchema = require('./models/userQuizScore');
const QuizResultSchema = require('./models/quizResult');

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
const ActivitySchema = require('./models/activity');
const { GlobalUserStatsSchema, GlobalGroupStatsSchema } = require('./models/globalStats');

let secondaryDb = null;
let CustomQuizModel = null;
let UserQuizScoreModel = null;
let QuizResultModel = null;

let Activity = null;
let GlobalUserStats = null;
let GlobalGroupStats = null;

async function connectToDatabases() {
  const MONGO_URI = process.env.mongouri;
  const SECONDARY_MONGO_URI = process.env.SECONDARY_MONGO_URI;

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
    }

    // Initialize models on the main database connection
    Activity = mongoose.model("Activity", ActivitySchema);
    GlobalUserStats = mongoose.model("GlobalUserStats", GlobalUserStatsSchema);
    GlobalGroupStats = mongoose.model("GlobalGroupStats", GlobalGroupStatsSchema);

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
  getQuizResultModel: () => QuizResultModel
};
