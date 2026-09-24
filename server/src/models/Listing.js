import mongoose from 'mongoose';

export const CATEGORIES = ['textbooks', 'electronics', 'furniture', 'clothing', 'other'];
export const CONDITIONS = ['new', 'like-new', 'used', 'worn'];
export const STATUSES = ['active', 'sold', 'removed'];

const listingSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    price: { type: Number, required: true, min: 0 },
    category: { type: String, enum: CATEGORIES, default: 'other' },
    condition: { type: String, enum: CONDITIONS, default: 'used' },
    status: { type: String, enum: STATUSES, default: 'active' },
    seller: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

export const Listing = mongoose.model('Listing', listingSchema);