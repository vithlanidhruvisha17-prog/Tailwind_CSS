const mongoose = require('mongoose');

// Ye schema database mein "kaun kisko follow kar raha hai" save karega
const followSchema = new mongoose.Schema({
    follower: { type: String, required: true }, // Jo button dabayega
    following: { type: String, required: true }  // Jiski profile hai
});

module.exports = mongoose.model('Follow', followSchema);