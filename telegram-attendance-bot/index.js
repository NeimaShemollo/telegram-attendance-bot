import 'dotenv/config'; 
import { Telegraf, Markup } from 'telegraf';
import mongoose from 'mongoose';

const bot = new Telegraf(process.env.BOT_TOKEN);

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('🌿 Connected seamlessly to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));


const SessionSchema = new mongoose.Schema({
  classId: { type: String, required: true },
  studentId: { type: Number, required: true },
  fullName: { type: String, required: true },
  checksVerified: { type: Number, default: 0 },
  attendancePercentage: { type: Number, default: 0 }
});
SessionSchema.index({ classId: 1, studentId: 1 }, { unique: true });

const ClassSession = mongoose.model('ClassSession', SessionSchema);

// ==========================================
// 4. GLOBAL MEMORY STATE
// ==========================================
let activeClasses = {}; 

// 5. BOT ACTIONS & LOGIC
bot.command('pulse_check', async (ctx) => {
  const args = ctx.message.text.split(' ');
  const classId = args[1] || 'default_class';

  const targetChatId = process.env.CHANNEL_ID || ctx.chat.id;

  if (!activeClasses[classId]) {
    activeClasses[classId] = { totalChecksCount: 1 };
  } else {
    activeClasses[classId].totalChecksCount += 1;
  }

  const currentCheckNum = activeClasses[classId].totalChecksCount;

  try {
    await bot.telegram.sendMessage(
      targetChatId,
      `⏰ **Live Stream Attention Check #${currentCheckNum}!**\nClick the button within 2 minutes to prove you are watching!`,
      Markup.inlineKeyboard([
        Markup.button.callback('📱 I am here watching!', `verify:${classId}:${currentCheckNum}`)
      ])
    );
    ctx.reply(`📢 Attendance check #${currentCheckNum} posted successfully!`);

  } catch (err) {
    console.error(err);
    ctx.reply('❌ Failed to post check-in button to the channel.');
  }
});

bot.action(/^verify:(.+):(.+)\$/, async (ctx) => {
  const classId = ctx.match[1];
  const user = ctx.from;
  const fullName = `${user.first_name} ${user.last_name || ''}`.trim();

  try {
    let session = await ClassSession.findOne({ classId, studentId: user.id });

    if (!session) {
      session = new ClassSession({ classId, studentId: user.id, fullName });
    }

    session.checksVerified += 1;
    
    const totalPossible = activeClasses[classId]?.totalChecksCount || 1;
    session.attendancePercentage = Math.round((session.checksVerified / totalPossible) * 100);

    await session.save();
    await ctx.answerCbQuery(`✅ Verified! Your stream presence score is ${session.attendancePercentage}%`);
  } catch (err) {
    console.error(err);
    await ctx.answerCbQuery('❌ Error updating attendance data.');
  }
});

// ==========================================
// ADMIN REPORT GENERATOR
// ==========================================
bot.command('report', async (ctx) => {
  const args = ctx.message.text.split(' ');
  const classId = args[1];

  if (!classId) {
    return ctx.reply('⚠️ Please provide the Class ID. Example: /report math101');
  }

  try {
    // Fetch all student records for this specific class from MongoDB
    const records = await ClassSession.find({ classId }).sort({ attendancePercentage: -1 });

    if (records.length === 0) {
      return ctx.reply(`❌ No attendance data found for Class ID: "${classId}"`);
    }

    // Build a clean, readable text report
    let reportMessage = `📊 **Attendance Report for ${classId.toUpperCase()}**\n`;
    reportMessage += `Total Students Logged: ${records.length}\n`;
    reportMessage += `-----------------------------------\n\n`;

    records.forEach((student, index) => {
      let statusEmoji = student.attendancePercentage >= 75 ? '✅' : '⚠️';
      reportMessage += `${index + 1}. ${statusEmoji} **${student.fullName}**\n`;
      reportMessage += `   Presence Score: ${student.attendancePercentage}%\n\n`;
    });

    // Send the text sheet report directly to the admin
    ctx.reply(reportMessage, { parse_mode: 'Markdown' });

  } catch (err) {
    console.error(err);
    ctx.reply('❌ Error generating class report from database.');
  }
});

bot.command('end_class', (ctx) => {
  const args = ctx.message.text.split(' ');
  const classId = args[1] || 'default_class';

  if (activeClasses[classId]) {
    delete activeClasses[classId]; // Wipes local active counts
    ctx.reply(`🏁 Attendance tracking closed for session: "${classId}". You can now fetch the full data using: /report ${classId}`);
  } else {
    ctx.reply('⚠️ No active session found with that ID.');
  }
});

// 6. ENGINE START

bot.launch().then(() => console.log('🤖 Telegram Attendance Bot running on ES Modules!'));

// Graceful stop settings
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
