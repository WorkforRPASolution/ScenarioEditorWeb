'use strict'
const { MongoClient, GridFSBucket } = require('mongodb')
const Redis = require('ioredis')
const env = require('./env')

async function connect() {
  const mongo = new MongoClient(env.MONGODB_URI)
  await mongo.connect()
  const db = mongo.db() // URI 의 DB(EARS)
  const redis = new Redis(env.REDIS_URL) // DB0
  return { mongo, db, bucket: new GridFSBucket(db), redis, close: async () => { await mongo.close(); redis.disconnect() } }
}

module.exports = { connect }
