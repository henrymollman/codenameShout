//Server Config
//--------------
var express = require('express');
var path = require('path');
var db = require('./db.js');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var userController = require('./Controllers/userController.js');
var gpsController = require('./Controllers/gpsController.js');
var app = express();

// Initialize AWS
var AWS = require('aws-sdk');
AWS.config.loadFromPath(path.join(__dirname + '/lib/config/aws.json'));

var routes = require('./Routes/index');
/* allows access to users file in routes*/
var users = require('./Routes/users');
/* allows access to photos file in routes*/
var photos = require('./Routes/photos');
var gps = require('./Routes/gps');
var events = require('./Routes/events');
var api = require('./Routes/api');
var dashboard = require('./Routes/dashboard');

/* allows access to dashboard */
var dashboard = require('./Routes/dashboard');


// Headers set for testing
app.all('*', function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  next();
});

// uncomment after placing your favicon in /public
//app.use(favicon(__dirname + '/public/favicon.ico'));
app.use(logger('dev'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: false
}));
app.use(cookieParser());

app.use('/api', api);
app.use(express.static(path.join(__dirname, '../dashboard/public/'), {'index': 'splash.html'}));
app.use('/dashboard', express.static(path.join(__dirname, '../dashboard/public/')));


app.use('/users', users);
app.use('/photos', photos);
app.use('/gps', gps);
app.use('/events', events);
app.use('/dashboard', dashboard);
gpsController.pruneTree();


module.exports = app;

var mongoose = require('mongoose');

mongoURI = process.env.mongoURI || 'mongodb://localhost:27017/shoutr';
mongoose.connect(mongoURI);

var db = mongoose.connection;

db.on('error', console.error.bind(console, 'connection error:'));

db.once('open', function() {
  console.log('Mongodb connection open');
});

module.exports = db;

var config = require('../lib/config/aws.json');

// This function will provide the client with a temporary token used to upload photos to an Amazon S3 bucket.
exports.getClientConfig = function(req, res, next) {
  console.log('GET Client Config');
  return res.json(200, {
    awsConfig: {
      bucket: config.bucket
    }
  });
};

var AWS = require('aws-sdk');
var crypto = require('crypto');
var config = require('../lib/config/aws.json');
var createS3Policy;
var getExpiryTime;

// The AWS module provides the client with the hash key used to send photos from the device to the Amazon S3 bucket.

// This function provides the expiration configuration for the authentication token used to upload photos to Amazon S3
getExpiryTime = function() {
  var _date = new Date();
  return '' + (_date.getFullYear()) + '-' + (_date.getMonth() + 1) + '-' +
    (_date.getDate() + 1) + 'T' + (_date.getHours() + 3) + ':' + '00:00.000Z';
};

// the S3 policy is used to create the policy object needed to upload to Amazon
createS3Policy = function(contentType, callback) {
  var date = new Date();
  var s3Policy = {
    'expiration': getExpiryTime(),
    'conditions': [
      ['starts-with', '$key', 's3Upload/'], {
        'bucket': config.bucket
      }, {
        'acl': 'public-read'
      },
      ['starts-with', '$Content-Type', contentType], {
        'success_action_status': '201'
      },
    ["content-length-range", 0, 5242880]
    ]
  };

  // stringify and encode the policy
  var stringPolicy = JSON.stringify(s3Policy);
  var base64Policy = new Buffer(stringPolicy, 'utf-8').toString('base64');

  // sign the base64 encoded policy
  var signature = crypto.createHmac('sha1', config.secretAccessKey)
    .update(new Buffer(base64Policy, 'utf-8')).digest('base64');

  // build the results object
  var s3Credentials = {
    s3Policy: base64Policy,
    s3Signature: signature,
    AWSAccessKeyId: config.accessKeyId
  };

  // send it back
  callback(s3Credentials);
};

exports.getS3Policy = function(req, res) {
  createS3Policy(req.query.mimeType, function(creds, err) {
    if (!err) {
      return res.send(200, creds);
    } else {
      return res.send(500, err);
    }
  });
};

var Photo = require('../Models/Photo.js');
var Event = require('../Models/Event.js');

var dashboardController = {

  fetchPhotos: function(req, res) {
    console.log('dash controller fetchPhotos called');
    var limit = 30; 
    Photo.find({}).limit(limit).sort({timestamp : -1}).exec(function(err, data) {
      if (!err) {
        console.log('sending photos: ', data);
        res.status(200).json(data);
      } else {
        throw err;
        res.send(500);
      }
    }); 
  },

  fetchEvents: function(req, res) {
    var photoId = req.params.photoId;
    Event.find({photoId: photoId}).sort({timestamp : 1}).exec(function(error, photos) {
      if (error) res.status(500).send();
      res.status(200).json(photos);
    })
  },

  getNewPhotos: function(req, res) {
    var timestamp = req.params.timestamp;
    Photo.find({timestamp: {$gt: timestamp}}).sort({timestamp : -1}).exec(function(err, data) {
      if (!err) {
        console.log('sending photos: ', data);
        res.status(200).json(data);
      } else {
        throw err;
        res.send(500);
      }
    }); 
  }

};

module.exports = dashboardController;

// The event controller handles all events broadcast by users. It will perform the bulk of the work when a photo is taken or rebroadcast, 
// and will log all broadcast events into the database. It makes use of the GPS and User Controllers to perform its functions and a can retrieve information 
// from the photo objects.

var Event = require('../Models/Event.js');
var gpsController = require('../Controllers/gpsController.js');
var userController = require('../Controllers/userController.js');
var Photo = require('../Models/Photo.js');
var mongoose = require('mongoose');
var Promise = require('bluebird');

Promise.promisifyAll(mongoose);

var eventController = {

// this broadcast function handles all broadcast events. It takes in a request from the client, either directly or through the photo controller, and 
// checks the quadtree to find the recipient nodes for a broadcast given the broadcast's range.

  broadcast: function(req, res) {
    var photoId = req.body.photoId;
    var timestamp = req.body.timestamp;
    var userId = req.body.userId;
    var TTL = +req.body.TTL * 60000;
    var radius = +req.body.radius; 
    var caption = req.body.caption || "";

    var searchParams = {
      x: +req.body.x,
      y: +req.body.y,
      userId: userId,
      radius: +radius
    };

    userController.insertBroadcastItem(userId, photoId, caption);
    console.log('calling gps controller and getting nodes');
    var tree = gpsController.getNodes(searchParams);
    var nodes = tree.traverse();

    // the recipients are filtered by the gps controller's calculate distance function, using the Haversine formula
    var recipients = gpsController.calculateDist(searchParams, nodes);

    var eventItem = {
        photoId: photoId,
        TTL: TTL,
        radius: radius,
        timestamp: timestamp,
        caption: caption
    };

    var event = new Event({
      x: searchParams.x,
      y: searchParams.y,
      userId: userId,
      photoId: photoId,
      TTL: TTL,
      timestamp: timestamp,
      radius: radius,
      recipientList: recipients
    });

    // Using the bluebird library, we will create a promise object that will be resolved only when the photo query and event creation events are complete
    Promise.props({
      photo: Photo.findOne({photoId: photoId}),
      event: Event.create({
        x: searchParams.x,
        y: searchParams.y,
        userId: userId,
        photoId: photoId,
        TTL: TTL,
        timestamp: timestamp,
        radius: radius,
        recipientList: recipients
      })
    })
    .then(function(data) {
      console.log('Event created, calling events callback with photo' + data.photo +
        '\nevent ' + data.event);
        var photoRecipientList = [];
        var eventRecipientList = [];

        // here we begin checking the photo object to remove any users who have already received the photo. If the users are not in the photo recipient list,
        // they will be added to that list and entered into the event object before saving as having received the broadcast. If they have already received the 
        // photo, they will not receive it again and will not be added either the photo object or the event object as a recipient.
        data.event.recipientList.forEach(function(user) {
          if (data.photo.recipientList.indexOf(user.userId) === -1) {
            photoRecipientList.push(user.userId);
            eventRecipientList.push(user);
            console.log('pushed ' + user.userId);
          }
        });

        data.photo.recipientList = data.photo.recipientList.concat(photoRecipientList);
        data.event.recipientList = eventRecipientList;
        data.photo.save();
        data.event.save();
        return data;
      }, function(err) {
          console.log(err);
          res.send('photo not found');
      })
    // the recipients will now have their inbox updated with the newly broadcast photo, and will have the inbox sent to them via the user controller.
    .then(function(data) {
      data.event.recipientList.forEach(function(recipient) {
        userController.updateInbox(recipient.userId, data.event, function(inbox) {
          res.send(inbox);
      });
    res.end();
    });
    });
  },

  getEvents: function(req, res) {
    Event.find({}, function(err, event) {
      if (err) {
        console.log(err);
        res.send(err);
      }

      else if (event) {
        console.log(event);
        res.json(event);
      }

    });
  },

};


module.exports = eventController;

var quadtree = require('../Utils/QTree.js');
var queue = require('../Utils/Queue.js')
var userController = require('../Controllers/userController.js');

    if (typeof(Number.prototype.toRad) === "undefined") {
      Number.prototype.toRad = function() {
      return this * Math.PI / 180;
      };
    }

var gpsController = {

  // insert Coords will receive the user's coordinates to insert into the quadtree and return the contents of the user's inbox.
  insertCoords: function(req, res) {

    if (quadtree.inBounds(req.body)) {
    console.log('in bounds yes!');
    var userId = req.body.userId;


    var timestamp = new Date().getTime();

    var node = {
      x: +req.body.x,
      y: +req.body.y,
      userId: userId,
      timestamp: timestamp
    };

      quadtree.update(node);
      queue.addToQueue(node);

      userController.updateInbox(userId, node, function(inbox) {
        res.send(inbox);
      });
    }
    else {
      console.log('out of bounds')
      res.send('Out of bounds');
    }
  },

  // this function takes a request from the user and returns the quadrant that contains the nodes. 
  findNearbyNodes: function(req, res) {

    var searchParams = {
      x: req.body.x,
      y: req.body.y,
      userId: req.body.userId,
      radius: +req.body.radius
    };


    var tree = this.getNodes(searchParams);

    // because no callback is passed into this function, the nodes are collected and returned
    var nodes = tree.traverse();
    
    // to be sent to the user
    res.send(nodes);

  },

  // this function will delete any nodes that are past their expiration, and is called every second. The function will take a node from the queue
  // thta is due to be removed, and will call the quadtree's remove function and pass in the node returned from the queue. If a node has been updated
  // with more recent coordinates and a new timestamp, the function will not remove it. This ensures that only nodes with old timestamps will be 
  // removed.

  pruneTree: function() {
    var self = this;
    var node = queue.removeFromQueue();
    if (node) {
      var removedNode = this.removeNode(node);
      console.log('Removed ' + JSON.stringify(removedNode) + ' from quadtree');
    }
    setTimeout(function() {
      self.pruneTree();
    }, 1000);
  },

  // This will get the distance between two coordinates. The formula used below is the Haversine formula, which takes the arc of the earth's surface
  // into account when performing proximity calculations.

  calculateDist: function(item1, nodes) {
    var nodeObj = {},
      nodes = nodes || this.getNodes(item1),
      recipients = [];

    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].userId === item1.userId) nodes.splice(i, 1);
      break;
    }

    // let's remove the node that initiated the broadcast before checking for nearby coordinates
    for (var i = 0; i < nodes.length; i++) {
      if (!nodeObj[nodes[i].userId]) {
        console.log('adding this object to list ' + JSON.stringify(nodes[i]));
        recipients.push(nodes[i]);
      }
    }


    // The haversine formula is used to calculate the distance between two points, factoring in the spherical shape of the Earth
    var R = 6371;
    var lat1 = +item1.x;
    var lon1 = +item1.y;
    var lat2, lon2, dlat, dlon;
    var result = [];

    recipients.forEach(function(item2) {
      lat2 = +item2.x;
      lon2 = +item2.y;
      dLat = (lat2 - lat1).toRad();
      dLon = (lon2 - lon1).toRad();
      var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1.toRad()) * Math.cos(lat2.toRad()) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
      var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      console.log(c);
      var d = R * c;
      d = d * 0.621371;
      // console.log(d);

      if (d < item1.radius) {
        result.push({userId: item2.userId, y: item2.y, x: item2.x});
      }
    });
    return result;
  },

  // Find nodes in Quadtree
  getNodes: function(searchParams) {
    var node = quadtree.get(searchParams);
    return node;
  },

  // Invoke calculate distance function
  getDist: function(req, res) {
    var result = this.calculateDist(req.body);
    res.send(result);
  },

  // remove nodes from quadtree if they match the item sent
  removeNode: function(item) {
    return quadtree.remove(item);
  },

  // initiate the removal function
  initRemove: function(req, res) {
    var item = this.removeNode(req.body);
    res.send(item);
  },

  // load dummy data for testing, in this case one million coordinate points
  loadData: function(req, res) {
    var date = new Date();

    var randIntx = function() {
      return Math.random() * (125.3 - 67.8) - (125.3);
    };
    
    var randInty = function() {
      return Math.random() * (67.5 - 10) + 10;
    }
    
    var count = 0;
    
    while (count < 1000000) {
      var item = {};
      item.x = randIntx();
      item.y = randInty();
      item.timestamp = date;
      item.userId = Math.floor(Math.random() * 9999999);
      quadtree.put(item);
      count++;
    };
    res.end();
  },

};

module.exports = gpsController;

/* This controller adds and retrieves Photos from the database*/

var Photo = require('../Models/Photo.js');
var eventController = require('../Controllers/eventController.js');
var userController = require('../Controllers/userController.js');


var photoController = {

// The store photo function is used whenever a new photo is taken by the client and shared. The photo metadata is created and saved to the database
// after the photo has been uploaded to the Amazon S3 bucket. Once the photo metadata is saved, the storePhoto function calls the broadcast event function
// on the event Controller, which starts the process of updating all of the local users' inboxes with the photo.

  storePhoto: function(req, res) {
    console.log(JSON.stringify(req.body));
    var TTL = +req.body.TTL * 60000;
    var userId = req.body.userId;
    var photoId = req.body.photoId;
    var caption = req.body.caption;
    var data = {
      photoId: photoId,
      radius: +req.body.radius,
      TTL: TTL,
      timestamp: +req.body.timestamp,
      userId: userId,
      recipientList: [userId],
      caption: caption
    };
    Photo.findOne({
      photoId: photoId
    }, function(err, photo) {
      if (err) {
        console.log(err);
      }  else if (photo) {
        console.log('Photo already exists');
        res.send(photo);
      } else {
        Photo.create(data, function(err, result) {
        console.log('creating photo now');
          if (err) {
            console.log('error creating photo: ', err);
            res.send(500, err);
          } else {
            console.log('photo saved');
            eventController.broadcast(req, res);
          }
        });
      }
    });
  },

  getPhotos: function(req, res) {
    Photo.find({}, function(err, data) {
      if (!err) {
        res.send(200, data);
      } else {
        throw err;
      }
    });
  },


  testingFunc: function(req, res) {
    res.status(200);
    res.end();
  },

  deletePhoto: function(req, res) {
    var userId = req.body.userId;
    var photoId = req.body.photoId;
    userController.cullInbox(userId, photoId);
    res.end();
  },

  deleteAlbumPhoto: function(req, res) {
    var userId = req.body.userId;
    var photoId = req.body.photoId;
    userController.cullAlbum(req, res, userId, photoId);
  }
};

module.exports = photoController;

var User = require('../Models/User.js');
var Promise = require('bluebird');
var bcrypt = require('bcrypt-nodejs');

var userController = {

  // This function will generate a unique user ID for a user on signup.
  generateUserId: function() {
    var id = "";
    while (id.length < 7) {
      id += Math.floor(Math.random() * (10 - 1) + 1);
    }
    return id;
  },

  // This function saves a new user into the database and encrypts that user's password.
  signupUser: function(req, res) {
    var username = req.body.username;
    var password = bcrypt.hashSync(req.body.password);
    var email = req.body.email;
    var userId = this.generateUserId();

    this.getUserFromDB({
      username: req.body.username
    }, function(user) {
      if (!user) {
        var newUser = new User({
          username: username,
          password: password,
          userId: userId,
          email: email
        });

        newUser.save(function(err, newUser) {
          if (err) {
            console.log(err);
            res.status(500).send(err);
          }
          else {
            newUser.newUser = true;
            res.status(200).send(newUser);
          }
        });
      } 
      else {
        console.log('Account already exists');
        var errorCode = {errorCode: "Account already exists."}
        res.status(500).send(errorCode);
        }
      })
  },


  retrieveUsers: function(req, res, cb) {
    User.find({}, function(err, data) {
      if (!err && cb) {
        cb(data);
      } else if (err) throw err;
      else {
        res.send(data);
      }
    });
  },

  // This signup function can be used for users who sign up through the app or using their facebook accounts to authenticate. Depending on the size
  // of the password, the server will determine which method the client used to authenticate, and reacts appropriately.
  signinUser: function(req, res) {
    var username = req.body.username;
    var password = req.body.password;
    this.getUserFromDB({
      username: req.body.username
    }, function(user) {
      if (user && user.password.length > 20) {
        var hashedPassword = user.password;
        bcrypt.compare(password, hashedPassword, function(err, match) {
          if (err) {
            return (err);
            console.log('error');
          }
          else if (match) {
            console.log('a match');
            res.status(200).send(user);
          } else {
            console.log('not a match');
            var resError = {errorCode: "password"}
            res.status(500).send(resError);
          }
        });
      } 
      else if (user) {
         console.log('not a match');
          var resError = {errorCode: "password"}
          res.status(500).send(resError);
      }
      else {
        console.log('user not found');
        var resError = {errorCode: 'username'}
        res.status(500).send(resError);  
      }
    });
  },

// The facebook sign in function checks the user's access token that is sent by facebook against the user record in the database. If the user
// does not exist, this function will create him or her.
  fbSignin: function(req, res) {
    var self = this;
    var fbId = +req.body.password;
    console.log(JSON.stringify(req.body));
    this.getUserFromDB({
    password: fbId
    }, function(user) {
      if (user) {
        res.status(200).send(user);
        }
      else if (!user && req.body.username) {
        console.log('no user found');
        var userId = self.generateUserId();
        var email = req.body.email || "";
        newUser = new User({
          username: req.body.username,
          password: fbId,
          userId: userId,
          email: email
        });
        
        newUser.save(function(err, newUser) {
          if (err) {
            console.log(err);
            res.status(500).send(err);
          }
          res.status(200).send(newUser);
        });
      }
      else {
        var errorCode = {errorCode: 'user'};
        res.status(500).send(errorCode);
      }
    })
  },

// this function is used by other functions in the user controller to retrieve a user by userid, username or facebook access token when logging in.
  getUserFromDB: function(person, cb) {
    if (person.uuId) {
      User.findOne({
        uuId: person.uuId
      }, function(err, person) {
        if (err) console.log(err);
        else if (person) {
          return person;
        } else return null;
      });
    } else if (person.username) {
      User.findOne({
        username: person.username
      }, function(err, person) {
        if (err) console.log(err);
        else if (person) {
          if (cb) {
            cb(person);
          } else {
            console.log('User already exists');
            return 'User already exists';
          }
        } else cb(null);
      });
    }
    else if (person.password) {
      User.findOne({
        password: person.password
      }, function(err, person) {
        if (err) console.log(err);
        else if (person) {
          if (cb) {
            cb(person);
          } else {
            return user;
          }
        } else cb(null);
      });
    }
  },

  // this function takes in an event object from the event controller, and either updates the inbox and returns the inbox to be sent to the client,
  // or simply returns the inbox to the client if no event object is passed in. It also performs checks to be sure that no event broadcast is added
  // to the inbox more than once, and that there are no expired items in the user's inbox.

  updateInbox: function(userId, eventObj, cb) {

    if (eventObj && eventObj.photoId) {
      var caption = eventObj.caption || "";
          var broadcastEvent = {
            photoId: eventObj.photoId,
            TTL: eventObj.TTL,
            radius: eventObj.radius,
            timestamp: eventObj.timestamp,
            caption: caption
          };
        }

    User.findOne({
      userId: userId
    }, function(err, user) {

      if (err) {
        console.log(err);
        return err;
      }

      else if (user) {
        // any items that have expired do not remain in the inbox, depending on the time to live on the event and the current time
        var newInbox = user.inbox.reduce(function(acc, inboxItem) {
 

          var diff = eventObj.timestamp - inboxItem.timestamp;
          if (diff < inboxItem.TTL) {
            acc.push(inboxItem);
          }
          return acc;
        }, []);

        // this function will check the current inbox to ensure that no duplicates are entered into the user's inbox
        if (broadcastEvent) {
          var bool = true;
          newInbox.reduce(function(bool, eventItem) {
            if (bool && eventItem.photoId !== eventObj.photoId) {
              return true;
            } else return false;
          }, true);

          if (bool) {
            newInbox.push(broadcastEvent);
            user.inbox = newInbox;
            user.save();
          }

        }
        // save the inbox to the user object in the database
        user.update({
          inbox: newInbox
        }, function(err, data) {
          console.log('sending user the inbox');
          cb(user.inbox);
        });
      }
      else console.log('no user found');
    })
  },

  // this function is triggered by the client's saving a broadcast item to their album for later viewing
  insertBroadcastItem: function(userId, photoId, caption) {
    User.findOneAndUpdate({userId: userId}, {$push: {album: {photoId: photoId, caption: caption}}}, function(error, user){
      if (error) console.log(error);
      else console.log('item added to ' + user.username);
    })
  },

  // this function will clear out a user's inbox entirely.
  cullInbox: function(userId, photoId) {
    var query = {
      userId: userId
    }

    User.findOne(query, function(err, user) {
      if (err) console.log(err);

      else {
        if (user) {
          var inbox = user.inbox;
          for (var i = 0; i < inbox.length; i++) {
            if (user.inbox[i].photoId === photoId) {
              user.inbox.splice(i, 1);
              break;
            }  
          }
          user.inbox = inbox;
          user.save();
        };
      }
    });
  },


  addToAlbum: function(req, res) {
    console.log('addToAlbum: ', JSON.stringify(req.body));
    User.findOneAndUpdate({userId: req.body.userId}, {$push: {album: {photoId: req.body.photoId, caption: req.body.caption}}}, function(error, user){
      if (error) {
        res.status(500).send();
      } else {
        res.status(200).send();
      }
    });
  },

  // this function clears out a user's album entirely
  cullAlbum: function(req, res, userId, photoId) {
    var query = {
      userId: userId
    }

    User.findOne(query, function(err, user) {
      if (err) {
        console.log(err);
        res.status(500).send();
      } 

      else {
        if (user) {
          var album = user.album;
          for (var i = 0; i < album.length; i++) {
            if (user.album[i].photoId === photoId) {
              user.album.splice(i, 1);
              break;
            }  
          }
          user.album = album;
          user.save();
        };
        res.status(200).send();
      }
    });
  },

  // 
  getAlbum: function(req, res) {
    console.log('USERID: ', req.params.userId);
    var userId = req.params.userId;
    User.findOne({userId: userId}, function(error, user){
      if (error) {
        res.status(500).send();
      } else if (user) {
        console.log('USER.ALBUM: ', user.album);
        res.status(200).send(user.album);
      }
      else {
        console.log('User not found');
        res.status(500).send('User not found');
      }
    });
  },

  getInbox: function(req, res) {
    var userId = req.params.userId;
    User.findOne({userId: userId}, function(error, user){
      if (error) {
        res.status(500).send();
      } else if (user) {
        console.log('USER.INBOX: ', user.inbox);
        res.status(200).send(user.inbox);
      }
      else {
        console.log('User not found');
        res.status(500).send('User not found');
      }
    });
  },

  deleteInbox: function(req, res) {
    var userId = req.params.userId; 
    User.findOneAndUpdate({userId: userId}, {$set: {inbox : [] }}, { 'new' : true }, function(error, user){
      if (error) {
        res.status(500).send();
      } else {
        console.log('just cleared the users inbox: ', user.inbox);
        res.status(200).send(user.inbox);
      }
    });
  }

};

module.exports = userController;


var mongoose = require('mongoose');

var EventSchema = new mongoose.Schema({

  userId: {
    type: String,
    required: true,
    unique: false
  },

  photoId: {
    type: String,
    required: true,
    unique: false
  },

  timestamp: {
    type: Number,
    required: true,
    unique: true
  },

  TTL: {
    type: Number,
    required: true,
    unique: false
  },

  radius: {
    type: Number,
    required: true,
    unique: false
  },

  x: {
    type: Number,
    required: true,
    unique: false
  },

  y: {
    type: Number,
    required: true,
    unique: false
  },

  recipientList: {
    type: Array,
    required: false,
    unique: false
  }

});

module.exports = mongoose.model('Event', EventSchema);



var mongoose = require('mongoose');

var PhotoSchema = new mongoose.Schema({

  photoId: {
    type: String,
    required: true,
    unique: true
  },

  userId: {
    type: String,
    required: true,
    unique: false
  },

  radius: {
    type: Number,
    required: true,
    unique: false
  },

  TTL: {
    type: Number,
    required: true,
    unique: false
  },

  recipientList: {
    type: Array,
    required: false,
    unique: false
  },

  timestamp: {
    type: Number,
    required: true,
    unique: false 
  },

  caption: {
    type: String,
    required: false,
    unique: false
  }
});

module.exports = mongoose.model('Photo', PhotoSchema);

var mongoose = require('mongoose');

var UserSchema = new mongoose.Schema({

  userId: {
    type: String,
    required: true,
    unique: true 
  },

  username: {
    type: String,
    required: true,
    unique: true
  },

  password: {
    type: String,
    required: true,
    unique: false
  },

  inbox: {
    type: Array,
    required: false,
    unique: false
  },

  album: {
    type: Array,
    required: false,
    unique: false
  },

  email: {
    type: String,
    required: false,
    unique: false
  }

});

module.exports = mongoose.model('User', UserSchema);

var express = require('express');
var router = express.Router();
var api = require('../Controllers/api');
var aws = require('../Controllers/aws');
var fbToken = require('../lib/config/facebook.json')

router.get('/config', function(req, res) {
  console.log('GET /api/config');
  api.getClientConfig(req, res);
});

router.get('/s3Policy', aws.getS3Policy);

router.get('/fbToken', function(req, res) {
	console.log('GET /api/fbToken');
	res.status(200).send(fbToken.appID);
})

// All undefined api routes should return a 404
//router.get('/*', function(req, res) {
//  console.log('ERROR GET /api/*');
//  res.send(404);
//});

module.exports = router;

var express = require('express');
var router = express.Router();
var dashboardController = require('../Controllers/dashboardController.js');

router.get('/photos', function(req, res) {
  console.log('get req to photos recd');
  dashboardController.fetchPhotos(req, res);
});

router.get('/events/:photoId', function(req, res) {
  dashboardController.fetchEvents(req, res);
});

router.get('/photos/:timestamp', function(req, res) {
  dashboardController.getNewPhotos(req, res);
})

module.exports = router;
var express = require('express');
var router = express.Router();
var eventController = require('../Controllers/eventController.js');

router.post('/broadcast', function(req, res) {
  console.log('user broadcast');
  eventController.broadcast(req, res);
});

router.post('/getEvents', function(req, res) {
  console.log('getting events');
  eventController.getEvents(req, res);
});

module.exports = router;

var express = require('express');
var router = express.Router();
var gpsController = require('../Controllers/gpsController.js');

router.post('/position', function(req, res) {
  console.log('adding new GPS data');
  gpsController.insertCoords(req, res);
});

router.post('/getlocal', function(req, res) {
  console.log('getting nearby nodes');
  gpsController.findNearbyNodes(req, res);
});

router.post('/distance', function(req, res) {
  console.log('getting distance');
  gpsController.getDist(req, res);
});

router.get('/postdata', function(req, res) {
  console.log('posting data');
  gpsController.loadData(req, res);
});


module.exports = router;

var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', {
    title: 'Express'
  });
});

module.exports = router;

var express = require('express');
var router = express.Router();
var photoController = require('../Controllers/photoController.js');

router.post('/newPhoto', function(req, res) {
  console.log('got request to store photo');
  photoController.storePhoto(req, res);
});

router.get('/getPhotos', function(req, res) {
  console.log('getting Photos');
  photoController.getPhotos(req, res);
});

router.get('/test', function(req, res) {
  console.log('Testing Route pinged');
  photoController.testingFunc(req, res);
});

router.post('/delete', function(req, res) {
	console.log('Deleting photo ' + req.body.photoId);
	photoController.deletePhoto(req, res);
});

router.post('/deleteFromAlbum', function(req, res) {
  console.log('req to delete photo from album ' + req.body.photoId);
  photoController.deleteAlbumPhoto(req, res);
})

module.exports = router;

var express = require('express');
var router = express.Router();
var userController = require('../Controllers/userController.js');

/* GET users listing. */
router.get('/', function(req, res, next) {
  res.send('respond with a resource');
});

/* GET the list of users in the database*/
router.get('/list', function(req, res) {
  console.log('listing users');
  userController.retrieveUsers(req, res);
});

/*POST a new user to the database*/
router.post('/signup', function(req, res) {
  console.log('got signup request');
  userController.signupUser(req, res);
});
/* POST sign in an existing user*/
router.post('/signin', function(req, res) {
  console.log('got signin request');
  userController.signinUser(req, res);
});

router.post('/fbSignin', function(req, res) {
  console.log('got facebook signin request');
  userController.fbSignin(req, res);
});

router.post('/deleteUser', function(username) {
  console.log('deleting user');
  userController.deleteUser(username);
});

router.post('/clearInbox', function(req, res) {
  if (req.body.username) {
    console.log('clearing ' + req.body.username + '\'s inbox');
    userController.cullInbox(req, res);
  } else {
    console.log('clearing all inboxes');
    userController.cullInbox(req, res);
  }
});

router.get('/inbox/:userId', function(req, res) {
  console.log('getting user inbox');
  userController.getInbox(req, res);
});

router.get('/album/:userId', function(req, res) {
  console.log('getting album');
  userController.getAlbum(req, res);
});

router.post('/album', function(req, res) {
  console.log('adding another photo to album');
  userController.addToAlbum(req, res);
});

//this route is used when a user logs out or stops location polling so everything in the inbox gets deleted
router.get('/deleteInbox/:userId', function(req, res) {
  console.log('deleteInbox route called')
  userController.deleteInbox(req, res);
});

module.exports = router;

function Quadtree(boundaries, maxChildren, root, depth) {

  this.boundaries = boundaries || {
    x: -125.3,
    y: 10,
    width: 57.5,
    height: 57.5
  };

  this.maxChildren = maxChildren || 10;
  this.root = root || null;
  this.depth = depth || 0;
  this.quadrants = [];
  this.children = [];

}

// if we do not check if the coordinate is in bounds the tree will sudivide forever once it reaches max children...
Quadtree.prototype.inBounds = function(item) {
  if (item.x > this.boundaries.x && item.x < this.boundaries.x + this.boundaries.width &&
      item.y > this.boundaries.y && item.y < this.boundaries.y + this.boundaries.height) {
    return true;
  }
  else {
    return false;
  }
}


// insert function
Quadtree.prototype.put = function(item) {
  // if our quadrant is divided into sub quadrants...
  if (this.quadrants.length) {
    // find the correct quadrant
    var index = this.findIndex(item);

    // insert the item
    this.quadrants[index].put(item);
    // bail
    return;
  }

  // add the new coordinate object to the children array
  this.children.push(item);

  // check length against the max number of coordinates per quadrant
  var length = this.children.length;
  if (length > this.maxChildren && !(this.depth > 50)) { // (this.depth < this.maxChildren + 1) && 

    // create new quadrants
    this.subDivide();

    // now add those coordinates to their new quadrants
    for (var i = 0; i < length; i++) {
      this.put(this.children[i]);
    }

    // empty the array of children
    this.children = [];
  }
};


// find function
Quadtree.prototype.get = function(item, callback) {
  // if our quadrant is divided into sub quadrants...
  if (this.quadrants.length) {
    console.log('quadtree logging item ' + item);

    // find the correct quadrant
    if (this.checkRange(item)) {
      var index = this.findIndex(item);
      return this.quadrants[index].get(item);
    }

    // execute callback if it exists
    else if (callback) {
      callback(this.quadrants[index].get(item));
    }

    // otherwise just return the quadrant
    else {
      return this;
    }
  }

  // our quadtree does not have any quadrants
  else if (!this.quadrants.length && this.children.length) {
    console.log('what else if')

    // invoke callback if it is passed in
    if (callback) {
      callback(this);
    }
    // otherwise just return the quadrant
    else {
      return this;
    }
  }
  // just return the root of the quadtree
  else {
    console.log('returning root');
    return this.root || this;
  }
};

// get index
Quadtree.prototype.findIndex = function(item) {

  // create index to return
  var index;

  // find the midpoint of quadrant
  var horizontalMidpoint = this.boundaries.x + (this.boundaries.width / 2);
  var verticalMidpoint = this.boundaries.y + (this.boundaries.height / 2);

  //assign boolean value to check position
  var left = item.x < horizontalMidpoint;
  var bottom = item.y < verticalMidpoint;

  // check the positions for quadrant location to search
  if (left) {
    if (bottom) {
      index = 2;
    } else index = 0;
  } else {
    if (bottom) {
      index = 3;
    } else index = 1;
  }

  // return the quadrant index to getter function...
  return index;
};

// this check will either update a coordinate based on proximity and a matching user ID. If none is found, it will simply insert the coordinate into the quadtree
Quadtree.prototype.update = function(item) {
  var quadrant = this.get(item);
  var results = quadrant.children;
  var found;
  console.log(JSON.stringify(item));
  results.forEach(function(coord) {
    if (coord.userId === item.userId) {
      console.log('updating user');
      coord.x = item.x;
      coord.y = item.y;
      found = true;
    }
  });
  if (!found) {
    console.log('not found');
    this.put(item);
  }
};



// find last position then delete according to user id
Quadtree.prototype.remove = function(item) {
  console.log(JSON.stringify(item));
  var quadrant = this.get(item);
  var results = quadrant.children;
  var removedItem;
  item.x = +item.x;
  item.y = +item.y;
  for (var i = 0; i < results.length; i++) {
    if (results[i].userId === item.userId && results[i].timestamp === item.timestamp) {
      console.log('found a match = ' + results[i].userId);
      removedItem = results.splice(i, 1);
    }
  }
  // first perform check on child elements for threshold
  // if the quadrants have less than half of their root node's maximum children, fold the quadrants and re insert the nodes into the single quadrant
  if (this.quadrants.length && results.length < this.maxChildren / 2) {
    this.unfold(quadrant);
  }
  return removedItem;
};



// tree traversal
// this function will traverse through the quadtree, either executing a callback on every child or returning all of the children in a single array
Quadtree.prototype.traverse = function(callback, nodes) {

    if (this.children.length && callback) {
      var length = this.children.length;
      for (var i = 0; i < length; i++) {
          callback(this.children[i]);
      }

      if (this.quadrants.length) {
        var quadLength = this.quadrants.length;
        for (var j = 0; j < quadLength; j++) {
          this.quadrants[j].traverse(callback);
        }
      }
    }

    else if (!callback) {
      var nodes = nodes || [];

      if (this.children.length) {
        return nodes.concat(this.children);
        }

      else if (this.quadrants.length) {
        var quadLength = this.quadrants.length;
        for (var j = 0; j < quadLength; j++) {
          nodes = this.quadrants[j].traverse(null, nodes);
        }
      }
      return nodes;
    }
}


// broadcast function
// use find then find others in same quadrant

// subdivide quadrant when necessary
Quadtree.prototype.subDivide = function() {
  var root = this;
  var depth = this.depth + 1;
  var width = this.boundaries.width / 2;
  var height = this.boundaries.height / 2;
  var x = this.boundaries.x;
  var y = this.boundaries.y;

  // top left quadrant
  this.quadrants[0] = new Quadtree({
    x: x,
    y: y + height,
    width: width,
    height: height
  }, this.maxChildren, root, depth);

  // top right quadrant
  this.quadrants[1] = new Quadtree({
    x: x + width,
    y: y + height,
    width: width,
    height: height
  }, this.maxChildren, root, depth);

  // bottom left quadrant
  this.quadrants[2] = new Quadtree({
    x: x,
    y: y,
    width: width,
    height: height
  }, this.maxChildren, root, depth);

  // bottom right quadrant
  this.quadrants[3] = new Quadtree({
    x: x + width,
    y: y,
    width: width,
    height: height
  }, this.maxChildren, root, depth);
};


// this function will reduce four quadrants in a node to just the parent, and distribute the nodes within those quadrants to the parent's 
// children array

Quadtree.prototype.unfold = function(quad) {

  // check if root 
  if (quad.children.length && !quad.quadrants.length) {
    quad.root.unfold(quad.root);
  }
  
  var count = 0;

  quad.quadrants.forEach(function(quadrant) {
    count += quadrant.children.length;
  });

  if (count < quad.maxChildren / 2) {
    var nodes = quad.quadrants.reduce(function(acc, quadrant) {
      if (quadrant.children.length) {
        acc = acc.concat(quadrant.children);
      }
      return acc;
    }, []);

    quad.quadrants = [];

    nodes.forEach(function(node) {
      quad.put(node);
    });
  }
 };

// The Checkrange function will check if the radius of a broadcast events exceeds the boundaries of a quadrant, and if so the recursive process of finding
// nodes will stop and the node containing all of the children will be returned in the 'get' function

Quadtree.prototype.checkRange = function(coord, range) {
  var radius = coord.radius * 0.027065;

  var range = range || 
  {
    north: +coord.y + radius, 
    east: +coord.x + radius, 
    south: +coord.y - radius, 
    west: +coord.x - radius,
  };

  var bounds = {
    north: this.boundaries.y + this.boundaries.height,
    east: this.boundaries.x + this.boundaries.width,
    south: this.boundaries.y,
    west: this.boundaries.x,
  };

  if (bounds.north > range.north &&
      bounds.east > range.east &&
      bounds.south < range.south &&
      bounds.west < range.west) 
    {
      return true;
    }

    else {
      return false;
    }
};


module.exports = new Quadtree();


// The queue is responsible for removing nodes from the quadtree that have remained in the quadtree for more than one minute. The queue will 
// return any item that has expired, and checks the first item in the queue every one second. There are safeguards in place to keep the process
// from removing items from the quadtree that are not due to be removed, such as an exact timestamp check for an item being used to identify the
// correct node to be removed.

function Queue() {
	var _queue = [];

	var obj = {};

	obj.addToQueue = function(user) {
			_queue.push(user);
	};

	obj.removeFromQueue = function() {
		var timestamp = new Date().getTime();
		if (_queue.length && timestamp - _queue[0].timestamp > 60000) {
      console.log('Current time in ms = ' + timestamp + ' object timestamp = ' + _queue[0].timestamp + ' = ' + (timestamp - _queue[0].timestamp))
      console.log('Removing user ' + JSON.stringify(_queue[0]));
			return _queue.shift();
		}
    else return null;
	};

  return obj;
}

module.exports = new Queue();
var _ = require('lodash');

/**
 * Load environment configuration
 */
module.exports = _.merge(
  require('./env/all.js'),
  require('./env/' + process.env.NODE_ENV + '.js') || {});

var app = require('../app');
var supertest = require('supertest');
var should = require('should');
var photoController = require('../Controllers/photoController');
var Photo = require('../Models/Photo');
var User = require('../Models/User');

describe('Photo Controller', function() {

  it('s3 docsign function should return signed policyDoc when given valid userId and timeStamp', function(done) {
    User.create({
      username: "newUser",
      password: "1234",
      userId: "1234567"
    });
    supertest(app)
      .post('/photos/signPolicyDoc')
      .set('Content-Type', 'application/json')
      .send('{"userId": "1234567", "timeStamp": "1234567890123"}')
      .end(function(err, res) {
        should(res.body.bucket).be.exactly("ripple-photos");
        should(res.body.awsKey).be.exactly("AKIAIE5AVGKPA4OCKD5A");
        res.status.should.equal(200);
        User.remove({
          username: "newUser"
        }, function(err) {
          if (err) {
            console.log(err);
          }
        });
        done();

      });
  });

  it('s3 docsign function should not send signed doc policy if user is not recognized', function(done) {
    supertest(app)
      .post('/photos/signPolicyDoc')
      .set('Content-Type', 'application/json')
      .send('{"userId": "1234567", "timeStamp": "1234567890123"}')
      .end(function(err, res) {
        res.status.should.equal(400);
        done();
      });
  });

});

var mocha = require("mocha");

function importTest(name, path) {
  describe(name, function() {
    require(path);
  });
}

describe("tests", function() {
  importTest("userTests", './userTests.js');
  importTest("photoTests", './photoTests');
});

var app = require('../app');
var should = require('should');
var supertest = require('supertest');
var userController = require('../Controllers/userController');
var User = require('../Models/User');

describe('user controller', function() {

  it('should signup user if username does not exist', function(done) {
    supertest(app)
      .post('/users/signup')
      .set('Content-Type', 'application/json')
      .send('{"username": "newUser", "password": "1234"}')
      .end(function(err, res) {
        res.status.should.equal(200);
        done();
      });
  });

  it('should reject if username already exists', function(done) {
    supertest(app)
      .post('/users/signup')
      .set('Content-Type', 'application/json')
      .send('{"username": "newUser", "password": "1234"}')
      .end(function(err, res) {
        res.status.should.equal(500);
        done();
      });
  });

  it('should delete test user', function(done) {
    User.remove({
      username: "newUser"
    }, function(err) {
      if (err) {
        console.log(err);
      } else {
        User.findOne({
          username: "newUser"
        }, function(err, res) {
          if (err) {
            console.log(err);
          } else {
            should(res).be.exactly(null);
            done();
          }
        });
      }
    });
  });


});

{
  "accessKeyId": "AKIAIE5AVGKPA4OCKD5A",
  "secretAccessKey": "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",
  "region": "us-west-1",
  "bucket": "ripple-photos"
}
{
  "appID": "1587789804822086",
  "appSecret": "8cfaf8f4c82863fa330a7fd0701398a6"
}
var path = require('path');

var rootPath = path.normalize(__dirname + '/../../..');

module.exports = {
  root: rootPath,
  port: process.env.PORT || 3000
};

module.exports = {
  env: 'development'
};

module.exports = {
  env: 'production'
};

module.exports = {
  env: 'test'
};

var app = require('../../app.js');
var User = require('../../Models/User.js');
var photoController = require('../../Controllers/photoController.js');
var Photo = require('../../Models/Photo.js');
var mocha = require('mocha');
var quadtree = require('../../Utils/Qtree.js');
var Promise = require('bluebird');

var dummyBroadcast = {

  photoFind: function(){
    Photo.find({}, function(err, re2s){
      if(err){
        console.log('This is the error');
        console.log(err);
      } else {
        console.log('this is the find in dummy bcast');
        console.log(res);
      }
    });
  },

  fireStorePhoto: function(){
    var dummyPhoto = { body:{} }
    dummyPhoto.body.photoId = "43772621432956654430",
    dummyPhoto.body.userId = 7654321,
    dummyPhoto.body.radius = 5,
    dummyPhoto.body.TTL = 10,
    dummyPhoto.body.x = Math.random() * (122.525999 - 122.325999) - (122.525999);
    dummyPhoto.body.y = Math.random() * (37.813501 - 37.613501) + 37.613501;
    dummyPhoto.body.timestamp = new Date().getTime();

    photoController.storePhoto(dummyPhoto, {
      end: function() { return; },
      send: function() { return; }
    });
  },

  constantUser: function(){
    User.find({}, function(err, results){
      if(err){
        console.log(err);
      } else {
        console.log(results[0]['userId']);
        fireStorePhoto();
        return results[0][userId]; 
      }
    });
  }

}


module.exports = dummyBroadcast;

var app = require('../../app');
var gpsController = require('../../Controllers/gpsController.js');
var userController = require('../../Controllers/userController.js');
var User = require('../../Models/User.js');
var mocha = require('mocha');
var dummyBroadcast = require('./dummyBroadcast.js');


var populateApp = function(num){
  var userArr = [];
//creates an array of dummy users 
  var createDummyUserArr = function(num){ 

    //creates fake userId 
    var userId = function() {
      var id = "";
      while (id.length < 7) {
        id +=  Math.floor(Math.random() * (10 - 1) + 1);
      }
      return id;
    };

    // generates random 10 digit username
    var randomName = function() {
      var name = "";
      var letters = "abcdefghijklmnopqrstuvwxyz";
      for(var i=0; name.length<11; i++){
        var slice = Math.floor(Math.random()*27)
        name += letters.slice(slice, slice+1);
      }
      return name;
    };
    
    //generates random Lat in SF
    var genRndLat = function(){
      return Math.random() * (122.525999 - 122.325999) - (122.525999);
      // return genLat.toFixed(6);
    }
    //generates random Long in SF
    var genRndLong = function(){
      return Math.random() * (37.813501 - 37.613501) + 37.613501;
      // return genLong.toFixed(6);
    }
    var injectConstantUser = function(){
      var constantUser = {body: {}};
        constantUser.body = {};
        constantUser.body.userId = 7654321;
        constantUser.body.x = genRndLong();
        constantUser.body.y = genRndLat();
        constantUser.body.username = 'Eden';
        constantUser.body.password = 'edenrules';
      userArr.push(constantUser);
    }();

    var createUser = function(){
      var dummyUser = {body: {}}
      dummyUser.body.userId = userId();
      dummyUser.body.x = genRndLat();
      dummyUser.body.y = genRndLong();
      dummyUser.body.username = randomName();
      dummyUser.body.password = randomName();
      // dummyUser.body.inbox = []; 
      userArr.push(dummyUser);
    };

    while(userArr.length < num){
      createUser();
    }
  };

  createDummyUserArr(num);

  
  // calls the insertCoords method from gps conroller for all dummy users
  var populateQuadTree = function() {
    for(var i=0; i<userArr.length; i++){
      gpsController.insertCoords(userArr[i]);
    }
  };
  populateQuadTree();

  var populateUserDB = function(){
    for(var i=0; i<userArr.length; i++){

      User.create(userArr[i].body, function(err, result){
        if(err){
          console.log("Dummy User Create Error: ", err);
          return;
        } else {
          console.log("Successfully created dummy users: ", result);
        }
      });
    }
    dummyBroadcast.fireStorePhoto();
  };
  populateUserDB();

  // User.remove({}, function(err, result){
  //   if(err){
  //     console.log(err);
  //   } else {
  //     console.log(result);
  //   }
  // });

  //   User.find({}, function(err, res){
  //     if(err){
  //       console.log("this the error from pop: ", err);
  //     } else {
  //       console.log(res);
  //     }
  //   });
};


populateApp(20);



#!/usr/bin/env node

/**
 * Module dependencies.
 */

var app = require('../server/app.js');
var debug = require('debug')('codenameShout:server');
var http = require('http');

/**
 * Get port from environment and store in Express.
 */

var port = normalizePort(process.env.PORT || '3000');
app.set('port', port);

/**
 * Create HTTP server.
 */

var server = http.createServer(app);

/**
 * Listen on provided port, on all network interfaces.
 */

server.listen(port);
server.on('error', onError);
server.on('listening', onListening);

/**
 * Normalize a port into a number, string, or false.
 */

function normalizePort(val) {
  var port = parseInt(val, 10);

  if (isNaN(port)) {
    // named pipe
    return val;
  }

  if (port >= 0) {
    // port number
    return port;
  }

  return false;
}

/**
 * Event listener for HTTP server "error" event.
 */

function onError(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }

  var bind = typeof port === 'string'
    ? 'Pipe ' + port
    : 'Port ' + port;

  // handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(bind + ' requires elevated privileges');
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(bind + ' is already in use');
      process.exit(1);
      break;
    default:
      throw error;
  }
}

/**
 * Event listener for HTTP server "listening" event.
 */

function onListening() {
  var addr = server.address();
  var bind = typeof addr === 'string'
    ? 'pipe ' + addr
    : 'port ' + addr.port;
  debug('Listening on ' + bind);
}
