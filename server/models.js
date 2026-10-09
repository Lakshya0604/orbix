import mongoose from 'mongoose';
const { Schema, model } = mongoose;
export const User = model('User', new Schema({
  email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  isGuest: { type: Boolean, default: false, index: true },
  guestUses: { type: Number, default: 0 },
  name: { type: String, default: '' },
  avatar: { type: String, default: 'orbi' },
  passwordHash: String,
  googleId: { type: String, index: true, sparse: true },
  githubId: { type: String, index: true, sparse: true },
  resetHash: String, resetExpires: Date,
}, { timestamps: true }));
export const Server = model('Server', new Schema({
  userId: { type: Schema.Types.ObjectId, index: true, required: true },
  name: { type: String, required: true },
  slug: { type: String, required: true },
  url: { type: String, required: true },
  transport: { type: String, default: 'auto' },
  catalogId: String,
  authHeader: String,
  authSecret: String, // AES-GCM encrypted
  enabled: { type: Boolean, default: true },
}, { timestamps: true }));
export const Chat = model('Chat', new Schema({
  userId: { type: Schema.Types.ObjectId, index: true, required: true },
  title: { type: String, default: 'New chat' },
  shareId: { type: String, unique: true, sparse: true },
  messages: { type: Array, default: [] }, // {role, content, steps?}
}, { timestamps: true }));
export const Visit = model('Visit', new Schema({
  day: { type: String, index: true },
  path: String,
  ref: String,
  vid: String, // daily-rotating hash, no raw IP stored
  device: String,
  at: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 180 },
}));
export const AuthEvent = model('AuthEvent', new Schema({
  email: String,
  type: String, // signup | login
  how: String, // password | github | google
  at: { type: Date, default: Date.now, index: true, expires: 60 * 60 * 24 * 180 },
}));
