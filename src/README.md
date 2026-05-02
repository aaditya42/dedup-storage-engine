**Deduplicated File Storage Engine**

A scalable backend system that eliminates redundant file storage using chunk-level deduplication with SHA-256 hashing.

# Features
- Chunk-based deduplication
- MongoDB for metadata storage
- Redis caching layer
- Fault-tolerant design (works even if Redis is down)
- Modular backend architecture (controller-service pattern)

# Tech Stack
- Node.js
- Express.js
- MongoDB (Mongoose)
- Redis (ioredis)
