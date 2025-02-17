var async = require("async"),
  utils = require("./utils.js"), 
  redisClient;

function configure(dbClient) {
  redisClient = dbClient;
}

function addItem(table, item, cb, foreignKeys, secondaryIndexes) {
  var itemId = utils.newGuid();

  // Optional parameters.
  foreignKeys = foreignKeys || [];
  secondaryIndexes = secondaryIndexes || [];

  // Redis multi session.
  var multi = redisClient.multi();

  async.forEach(foreignKeys, function (foreignKey, cb2) {
    var foreignId = item[foreignKey.name].id;

    // We replace the foreign keys with a special value indicating from which table it is.
    item["foreign:{0}:{1}".format(foreignKey.table, foreignKey.name)] = foreignId;
    delete item[foreignKey.name];

    // We then create the inverse relation.
    multi.sadd("{0};{1};{2}".format(foreignKey.table, foreignId, table), itemId);
    cb2(null);
  }, function (err) {
    // We now process the secondary indexes.
    async.forEach(secondaryIndexes, function (secondaryIndex, cb2) {
      // We create a key for the secondary index.
      multi.set("{0}!{1}!{2}".format(table, secondaryIndex, item[secondaryIndex]), itemId);

      item["sec:" + secondaryIndex] = item[secondaryIndex];
      delete item[secondaryIndex];

      cb2(null);
    }, function (err2) {
      // Finally, we create the object in the DB.
      multi.hmset("{0}:{1}".format(table, itemId), item);
      multi.exec(function (err, replies) {
        cb(err, itemId);
      });
    });
  });
}

function deleteItem(table, itemId, cb, cascade, multi) {
  // Optional parameters.
  cascade = cascade === undefined ? true : cascade;

  var doExec = false;
  if (!multi) {
    multi = redisClient.multi();
    doExec = true;
  }

  // First, we retrieve the object to delete.
  redisClient.hgetall("{0}:{1}".format(table, itemId), function (err, obj) {
    // We check for foreign keys.
    var foreignKeys = [];
    var secondaryIndexes = [];

    for (var key in obj) {
      if (key.startsWith("foreign")) {
        foreignKeys.push(key);                
      } else if (key.startsWith("sec:")) {
        secondaryIndexes.push(key);
      }
    }
    
    async.forEach(foreignKeys, function (foreignKey, cb2) {
      var foreignKeyParts = foreignKey.split(":");
    
      // We remove the inverse relation with this foreign key.
      multi.srem("{0};{1};{2}".format(foreignKeyParts[1], obj[foreignKey], table), itemId);
      cb2(null);
    }, function (err2) {

      // We now find any downward relation table.
      redisClient.keys("{0};{1};*".format(table, itemId), function (err3, downKeys) {
        async.forEach(downKeys, function (downKey, cb2) {    
          var secondPart = function () {
            // We delete the whole set.
            multi.del(downKey);
            cb2(null);
          };

          // If cascade, we then delete all the down items.
          if (cascade) {
            // We retrieve the Ids of the elements in the set.
            redisClient.smembers(downKey, function (err4, replies) {
              var downKeyParts = downKey.split(";");
              async.forEach(replies, function (downId, cb3) {
                deleteItem(downKeyParts[2], downId, cb3, cascade, multi);
              }, function (err5) {
                secondPart();     
              });
            });
          } else {
            secondPart();
          }
        }, function (err4) {
          // We delete secondary indexes.
          async.forEach(secondaryIndexes, function (secondaryIndex, cb2) {
            
            var keyName = secondaryIndex.split(":")[1];
            multi.del("{0}!{1}!{2}".format(table, keyName, obj[secondaryIndex]));

            cb2(null);          
          }, function (err5) {
            
            // We can now delete the object.
            multi.del("{0}:{1}".format(table, itemId));

            if (doExec) {
              multi.exec(function (err, replies) {
                cb(err);
              });
            } else {
              cb(err);
            }

          });
        });
      });
    });
  });
}

function getSingleItemFromSec(table, indexName, indexValue, cb) {
  redisClient.get("{0}!{1}!{2}".format(table, indexName, indexValue), function (err, reply) {
    if (err) {
      cb(err);
    }

    getSingleItem(table, reply, cb);
  });
}

function getSingleItem(table, itemId, cb) {
  redisClient.hgetall("{0}:{1}".format(table, itemId), function (err, obj) {
    if (err) {
      cb(err);
      return;
    }

    // We check for foreign keys & secondary indexes.
    var foreignKeys = [];
    var secondaryIndexes = [];

    for (var key in obj) {
      if (key.startsWith("foreign")) {
        foreignKeys.push(key);
      } else if (key.startsWith("sec:")) {
        secondaryIndexes.push(key);
      }
    }

    async.forEach(foreignKeys, function (foreignKey, cb2) {
      var foreignKeyParts = foreignKey.split(":");
      getSingleItem(foreignKeyParts[1], obj[foreignKey], function (err, fkObj) {
        if (err) {
          cb2(err);
          return;
        }

        obj[foreignKeyParts[2]] = fkObj;
        delete obj[foreignKey];
        cb2(null);
      });
    }, function (err) {
      // We rename secondary indexes.
      async.forEach(secondaryIndexes, function (secondaryIndex, cb2) {
        var keyName = secondaryIndex.split(":")[1];

        obj[keyName] = obj[secondaryIndex];
        delete obj[secondaryIndex];

        cb2(null);
      }, function (err2) {
        if (err) {
          cb(err);
          return;
        }

        // We set the id for this object.
        obj.id = itemId;

        cb(null, obj);
      });
    });
  });
}

function getAllItems(table, cb) {
	redisClient.keys(table + ":*", function (err, keys) {
    if (err) {
      cb(err);
      return;
    }

    async.map(keys, function (key, cb2) {
      // To replace with "getSingleItem"
      redisClient.hgetall(key, function (err2, st) {
        if (err) {
          cb2(err);
          return;
        }

        cb2(null, st);
      });
    }, function(err, sts) {
      cb(null, sts);
    });
  });
}

exports.configure = configure;
exports.addItem = addItem;
exports.deleteItem = deleteItem;
exports.getSingleItemFromSec = getSingleItemFromSec;
exports.getSingleItem = getSingleItem;
exports.getAllItems = getAllItems;