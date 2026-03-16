const mongoose = require('mongoose');
const CustomQuizSchema = require('./models/quiz');
const UserQuizScoreSchema = require('./models/userQuizScore');

const Invite = require('./models/invite');
const UserMap = require('./models/userMap');
const BannedUser = require('./models/banned');
const NSFWSetting = require('./models/nsfw');
const accceptMap = require('./models/accept');

let secondaryDb = null;
let CustomQuizModel = null;
let UserQuizScoreModel = null;

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
  getCustomQuizModel: () => CustomQuizModel,
  getUserQuizScoreModel: () => UserQuizScoreModel
};
