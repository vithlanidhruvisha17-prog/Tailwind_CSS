const postSchema = new mongoose.Schema({
    content: String,
    username: String, 
    createdAt: { type: Date, default: Date.now }
});