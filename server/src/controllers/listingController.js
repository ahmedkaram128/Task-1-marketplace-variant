import Joi from 'joi';
import mongoose from 'mongoose';
import { Listing, CATEGORIES, CONDITIONS } from '../models/Listing.js';
import { User } from '../models/User.js';

// Only fields a client may set. `status` is deliberately absent: it only
// changes through DELETE (-> removed) and PATCH /:id/sold (-> sold).
const objectId = Joi.string().custom((value, helpers) =>
  mongoose.isValidObjectId(value) ? value : helpers.error('any.invalid')
);

const createSchema = Joi.object({
  title: Joi.string().trim().min(1).max(120).required(),
  description: Joi.string().trim().max(2000).allow(''),
  price: Joi.number().min(0).required(),
  category: Joi.string().valid(...CATEGORIES),
  condition: Joi.string().valid(...CONDITIONS),
  seller: objectId
});

const updateSchema = Joi.object({
  title: Joi.string().trim().min(1).max(120),
  description: Joi.string().trim().max(2000).allow(''),
  price: Joi.number().min(0),
  category: Joi.string().valid(...CATEGORIES),
  condition: Joi.string().valid(...CONDITIONS),
  seller: objectId
}).min(1);

// Never expose the seller's password hash.
const SELLER_FIELDS = 'name email';

// A malformed id would otherwise throw a CastError and surface as a 500.
function badId(req, res) {
  if (mongoose.isValidObjectId(req.params.id)) return false;
  res.status(400).json({ message: 'Invalid listing id' });
  return true;
}

async function sellerMissing(value, res) {
  if (!value.seller) return false;
  if (await User.exists({ _id: value.seller })) return false;
  res.status(400).json({ message: 'Seller not found' });
  return true;
}

// GET /api/listings?includeRemoved=true
export async function getAllListings(req, res, next) {
  try {
    const includeRemoved = req.query.includeRemoved === 'true';
    const filter = includeRemoved ? {} : { status: { $ne: 'removed' } };
    const listings = await Listing.find(filter)
      .sort({ createdAt: -1 })
      .populate('seller', SELLER_FIELDS)
      .lean();
    res.json({ listings });
  } catch (err) { next(err); }
}

// GET /api/listings/:id?includeRemoved=true
export async function getListing(req, res, next) {
  try {
    if (badId(req, res)) return;
    const listing = await Listing.findById(req.params.id).populate('seller', SELLER_FIELDS).lean();
    const hidden = listing?.status === 'removed' && req.query.includeRemoved !== 'true';
    if (!listing || hidden) return res.status(404).json({ message: 'Listing not found' });
    res.json({ listing });
  } catch (err) { next(err); }
}

// POST /api/listings
export async function createListing(req, res, next) {
  try {
    const { value, error } = createSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ message: error.message });
    if (await sellerMissing(value, res)) return;

    const listing = await Listing.create(value);
    res.status(201).json({ listing });
  } catch (err) { next(err); }
}

// PATCH /api/listings/:id — only active listings are editable.
export async function updateListing(req, res, next) {
  try {
    if (badId(req, res)) return;
    const { value, error } = updateSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) return res.status(400).json({ message: error.message });
    if (await sellerMissing(value, res)) return;

    // Status condition in the filter makes check-and-update atomic.
    const listing = await Listing.findOneAndUpdate(
      { _id: req.params.id, status: 'active' },
      { $set: value },
      { new: true, runValidators: true }
    );
    if (!listing) return notActive(req, res);
    res.json({ listing });
  } catch (err) { next(err); }
}

// PATCH /api/listings/:id/sold — active -> sold, no other fields touched.
export async function markSold(req, res, next) {
  try {
    if (badId(req, res)) return;
    const listing = await Listing.findOneAndUpdate(
      { _id: req.params.id, status: 'active' },
      { $set: { status: 'sold' } },
      { new: true }
    );
    if (!listing) return notActive(req, res);
    res.json({ listing });
  } catch (err) { next(err); }
}

// DELETE /api/listings/:id — soft delete: the document stays in MongoDB.
export async function deleteListing(req, res, next) {
  try {
    if (badId(req, res)) return;
    const listing = await Listing.findOneAndUpdate(
      { _id: req.params.id, status: { $ne: 'removed' } },
      { $set: { status: 'removed' } },
      { new: true }
    );
    if (!listing) return res.status(404).json({ message: 'Listing not found' });
    res.json({ listing });
  } catch (err) { next(err); }
}

// Tells apart "doesn't exist / removed" (404) from "sold, so locked" (409).
async function notActive(req, res) {
  const existing = await Listing.findById(req.params.id).select('status').lean();
  if (!existing || existing.status === 'removed') {
    return res.status(404).json({ message: 'Listing not found' });
  }
  res.status(409).json({ message: `Listing is ${existing.status} and can no longer be changed` });
}