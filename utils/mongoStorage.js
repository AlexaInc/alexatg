class MongoStorage {
    constructor(model) {
        this.model = model;
    }

    async initialize() {
        return Promise.resolve();
    }

    async get(key) {
        try {
            const doc = await this.model.findOne({ key });
            return doc ? doc.value : null;
        } catch (err) {
            console.error(`MongoStorage.get(${key}) error:`, err.message);
            return null;
        }
    }

    async set(key, value) {
        try {
            await this.model.updateOne(
                { key },
                { $set: { value } },
                { upsert: true }
            );
        } catch (err) {
            console.error(`MongoStorage.set(${key}) error:`, err.message);
        }
    }

    async delete(key) {
        try {
            await this.model.deleteOne({ key });
        } catch (err) {
            console.error(`MongoStorage.delete(${key}) error:`, err.message);
        }
    }

    async *getMany(filter) {
        try {
            const query = {};
            if (filter?.prefix) {
                query.key = { $regex: `^${filter.prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}` };
            }

            const docs = await this.model.find(query).cursor();
            for await (const doc of docs) {
                yield [doc.key, doc.value];
            }
        } catch (err) {
            console.error(`MongoStorage.getMany() error:`, err.message);
        }
    }
}

module.exports = MongoStorage;
