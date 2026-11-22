// Idempotent single-node replica set initialisation, run as the container health check.
// Exits 0 only once this node is the writable primary, so dependants start only when
// transactions are actually available.
try {
  rs.status();
} catch (error) {
  if (error.codeName === 'NotYetInitialized' || /no replset config/i.test(String(error.message))) {
    rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });
  } else {
    throw error;
  }
}
if (!db.hello().isWritablePrimary) {
  quit(1);
}
