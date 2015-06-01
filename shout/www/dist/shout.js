angular.module('shout', [
  'ionic',
  'shout.constants',
  'shout.localstorage',
  'shout.tabs',
  'shout.login',
  'shout.signup',
  'shout.inbox',
  'shout.review',
  'shout.settings',
  'shout.camera',
  'shout.album',
  'shout.location',
  'shout.broadcast'
  //list the other modules that contain factories and controllers that you will use
]);

angular.module('shout.album', []);

angular.module('shout.broadcast', [
]);

angular.module('shout.camera', [
  'shout.localstorage'
  //list the other modules that contain factories and controllers that you will use
]);

angular.module('shout.inbox', [
  //list the other modules that contain factories and controllers that you will use
  'shout.album',
  'shout.camera'
]);

angular.module('shout.tabs', [
  'shout.localstorage',
  'shout.camera'
]);

angular.module('shout.localstorage', [
]);

angular.module('shout.location', [
  //list the other modules that contain factories and controllers that you will use
]);

angular.module('shout.login', [
  //list the other modules that contain factories and controllers that you will use
  'shout.location',
  'shout.localstorage'
]);

angular.module('shout.signup', [
//list the other modules that contain factories and controllers that you will use
]);

angular.module('shout.review', [
  'shout.camera'
  //list the other modules that contain factories and controllers that you will use
]);

angular.module('s3Upload', [
]);

angular.module('shout.settings', [
  'shout.localstorage',
  'shout.camera',
  'shout.location',
  's3Upload',
  'shout.constants'
  // 'shout.login'
  //list the other modules that contain factories and controllers that you will use
]);

angular.module("shout.constants", [])
  .constant("API_HOST", "https://6214a3e3.ngrok.com");


angular
  .module('shout')
  .config(configure);

configure.$injector = ['$stateProvider', '$urlRouterProvider', '$compileProvider', '$sceDelegateProvider'];

function configure($stateProvider, $urlRouterProvider, $compileProvider, $sceDelegateProvider) {
  console.log('shout configure');
  $compileProvider.imgSrcSanitizationWhitelist(/^\s*(https?|ftp|mailto|file|tel):/);
  $sceDelegateProvider.resourceUrlWhitelist([
    'self',
    'https://s3-us-west-1.amazonaws.com/ripple-photos/s3Upload/**']);

  // Ionic uses AngularUI Router which uses the concept of states
  $stateProvider

    .state('login', {
    url: '/login',
    templateUrl: 'app/login/login.html',
    controller: 'LoginCtrl as vm'
  })

  .state('signup', {
    url: '/signup',
    templateUrl: 'app/login/signup.html',
    controller: 'SignupCtrl as vm'
  })

  .state('review', {
    url: '/review',
    templateUrl: 'app/review/tab-review.html',
    controller: 'ReviewCtrl as vm'
  })

  //setup an abstract state for the tabs directive
  .state('tab', {
    url: '/tab',
    abstract: true,
    templateUrl: 'app/layout/tabs.html',
    controller: 'TabsCtrl as vm'
  })

  //Each tab has its own nav history stack:
  .state('tab.inbox', {
    url: '/inbox',
    views: {
      'tab-inbox': {
        templateUrl: 'app/inbox/tab-inbox.html',
        controller: 'InboxCtrl as vm'
      }
    }
  })

  .state('tab.settings', {
    url: '/settings',
    views: {
      'tab-settings': {
        templateUrl: 'app/settings/tab-settings.html',
        controller: 'SettingsCtrl as vm'
      }
    }
  })

  /*
  .state('tab.camera', {
      url: '/camera',
      views: {
        'tab-camera': {
          templateUrl: 'app/camera/tab-camera.html',
          controller: 'CameraCtrl'
        }
      }
    })
    */
  .state('tab.album', {
    url: '/album',
    views: {
      'tab-album': {
        templateUrl: 'app/album/tab-album.html',
        controller: 'AlbumCtrl as vm'
      }
    }
  });

  // if none of the above states are matched, use this as the fallback
  $urlRouterProvider.otherwise('/login');

}

angular
  .module('shout')
  .run(run);

run.$inject = ['$http', '$rootScope', 'API_HOST'];

function run($http, $rootScope, API_HOST) {
  console.log('shout run');
  ionic.Platform.ready(function() {
    console.log('ionic platform ready');

    $http.get(API_HOST+'/api/config').success(function(config) {
      $rootScope.config = config;
    });

    // Hide the accessory bar by default (remove this to show the accessory bar above the keyboard
    // for form inputs)
    if (window.cordova && window.cordova.plugins && window.cordova.plugins.Keyboard) {
      cordova.plugins.Keyboard.hideKeyboardAccessoryBar(true);
    }
    if (window.StatusBar) {
      // org.apache.cordova.statusbar required
      StatusBar.styleLightContent();
    }
  });
}

angular
  .module('shout.album')
  .controller('AlbumCtrl', AlbumCtrl);

AlbumCtrl.$inject = ['$scope', '$state', 'AlbumFactory'];

function AlbumCtrl($scope, $state, AlbumFactory) {
  console.log('AlbumCtrl');
  var vm = this;
  vm.photos = [];
  vm.addPhotos = addPhotos;
  vm.getSrc = getSrc; 

  AlbumFactory.getAlbum();

  $scope.$on('updateAlbum', function(event, data) {
    vm.photos = vm.photos.concat(data);
  });

  function addPhotos(photos) {
    vm.photos = vm.photos.concat(photos);
  }

  function getSrc(photoId){
    return "https://s3-us-west-1.amazonaws.com/ripple-photos/s3Upload/" + photoId + ".jpeg";
  }

}


angular
  .module('shout.album')
  .factory('AlbumFactory', AlbumFactory);

AlbumFactory.$inject = ['$rootScope', '$http', '$localstorage', 'API_HOST'];

function AlbumFactory($rootScope, $http, $localstorage, API_HOST) {
  console.log('AlbumFactory');
  var services = {};

  services.photos = [];
  services.savePhoto = savePhoto;
  services.getAlbum = getAlbum;
  services.checkCollision = checkCollision;
  services.updateAlbum = updateAlbum;


  return services;

  function updateAlbum(photos) {
    console.log('updateAlbum called');
    services.photos = services.photos.concat(photos);
    console.log('services.photos after concat: ', services.photos);
    $rootScope.$broadcast('updateAlbum', photos);
  }

  function savePhoto(photo) {
    if (!checkCollision(photo)) {
      var photoIdObj = {
        userId: $localstorage.get('userId'),
        photoId: photo.photoId
      };
      console.log('asking server to add photo to album: ', photoIdObj);
      $http.post(API_HOST + '/users/album', photoIdObj)
        .success(function(data) {
          services.updateAlbum([{
            photoId: photo.photoId
          }]);
        });
    }
  }


  function getAlbum() {
    var userId = $localstorage.get('userId');
    $http.get(API_HOST + '/users/album/' + userId)
      .success(function(data) {
        console.log('success getting album!!');
        services.updateAlbum(services.photos);
      });
  }

  function checkCollision(photo) {
    var idArray = [];
    services.photos.forEach(function(item) {
      idArray.push(item.photoId);
    });
    return _.contains(idArray, photo.photoId);
  }


}

angular
  .module('shout.broadcast')
  .factory('BroadcastFactory', BroadcastFactory);

BroadcastFactory.$inject = ['LocationFactory', '$http', 'API_HOST'];

function BroadcastFactory(LocationFactory, $http, API_HOST) {

  var services = {};
  services.newPhoto = newPhoto;
  services.reBroadcast = reBroadcast;
  services.sendBroadcastEvent = sendBroadcastEvent;

  return services;

  function newPhoto() {
    console.log('newPhoto');
    var pos = LocationFactory.currentPosition;
    var data = {};
    data.x = pos.x;
    data.y = pos.y;
    data.userId = userId;
    data.photoId = photoId;
    data.TTL = vm.TTL;
    data.radius = vm.radius;
    data.timestamp = timestamp;
    $http.post(API_HOST + '/photos/newPhoto', data)
      .success(callback);
  }

  function reBroadcast(photo) {
    console.log('currentPosition: ', LocationFactory.currentPosition);
    if (LocationFactory.currentPosition && LocationFactory.currentPosition.userId &&
        LocationFactory.currentPosition.x && LocationFactory.currentPosition.y) {
      photo = _.extend(photo, LocationFactory.currentPosition);
      photo.timestamp = new Date().getTime();
      console.log('reBroadcast this photo: ', photo);
      services.sendBroadcastEvent(photo);
    } else {
      console.log('sorry cant broadcast that photo');
    }
  }

  function sendBroadcastEvent (broadcastEvent) {
    $http.post(API_HOST + '/events/broadcast', broadcastEvent).success(function(){console.log('sent broadcast event to server!!!');});
  }
}

angular
  .module('shout.camera')
  .factory('CameraFactory', CameraFactory);

CameraFactory.$inject = [];

function CameraFactory() {
  console.log('CameraFactory');

  var pictureSource;
  var destinationType; 
  var options;

  var services = {};
  services.takePicture = takePicture;
  services.getFile = getFile;
  services.filePath = '';

  return services;


  function takePicture(callback) {
    console.log('CameraFactory.takePicture');
    initialize(function() {
      getPicture(callback);
    });
  }

  function initialize(callback) {
    console.log('CameraFactory.initialize');
    ionic.Platform.ready(function() {
      if (!navigator.camera) {
        // error handling
        console.log('no camera found');
      } else {
        //pictureSource=navigator.camera.PictureSourceType.PHOTOLIBRARY;
        pictureSource = navigator.camera.PictureSourceType.CAMERA;
        destinationType = navigator.camera.DestinationType.FILE_URI;
        options = {
          quality: 50,
          destinationType: destinationType,
          sourceType: pictureSource,
          encodingType: Camera.EncodingType.JPEG 
        };
      }
      callback();
    });
  }

  function getPicture(callback) {
    console.log('CameraFactory.getPicture');
    navigator.camera.getPicture(success, failure, options);

    function success(imageURI) {
      console.log('getPicture success with:' + imageURI);
      services.filePath = imageURI;
      callback(imageURI);
    }

    function failure(message) {
      console.log('getPicture failed because: ' + message);
    }
  }

  function getFile(callback) {
    console.log('CameraFactory.getFile');
    window.resolveLocalFileSystemURL(services.filePath, success, failure);

    function success(fileEntry) {
      console.log('getFile success');

      fileEntry.file(function(file) {
        services.photo = file; 
        console.log('File Object', file);
        callback(file);
      });
    }

    function failure(message) {
        console.log('getFile failed because: ' + message);
    }
  }
}

angular
  .module('shout.inbox')
  .controller('InboxCtrl', InboxCtrl);

InboxCtrl.$inject = ['$scope', '$state', 'InboxFactory', 'AlbumFactory', 'CameraFactory', 'BroadcastFactory'];

function InboxCtrl($scope, $state, InboxFactory, AlbumFactory, CameraFactory, BroadcastFactory) {
  console.log('InboxCtrl');
  var vm = this;
  var currentStart = 0;

  vm.photos = [];
  vm.newPhotos = [];
  vm.data = CameraFactory.data;
  vm.obj = CameraFactory.obj;
  vm.takePicture = CameraFactory.takePicture;
  vm.query = CameraFactory.query;
  vm.addPhotos = addPhotos;
  vm.doRefresh = doRefresh;
  vm.loadMore = loadMore;
  vm.reBroadcast = reBroadcast;
  vm.saveToAlbum = saveToAlbum;
  vm.clearInbox = clearInbox;
  vm.getSrc = getSrc;
  vm.morePhotosVar = false;
  vm.canScroll = false;

  vm.addPhotos(InboxFactory.photos);

  $scope.$on('updateInbox', function(event, data) {
    console.log('update inbox event heard!!!');
    newPhotos = InboxFactory.filterForNew(vm.photos, InboxFactory.photos);
    vm.clearInbox();
    vm.addPhotos(newPhotos);
  });

  function doRefresh() {
    console.log('doRefresh called');
    InboxFactory.requestInbox();     
    $scope.$broadcast('scroll.refreshComplete');
  }

  function loadMore() {
    console.log('loadMore called');
    if (vm.morePhotosVar) {
      vm.canScroll = true;
    } else {
      vm.canScroll = false;
    }
    $scope.$broadcast('scroll.infiniteScrollComplete');
  }

  function addPhotos(photos) {
    vm.photos = vm.photos.concat(photos);
    vm.morePhotosVar = true;
  }

  function clearInbox() {
    vm.photos = InboxFactory.removeExpired(vm.photos, InboxFactory.photos);

  }

  function reBroadcast(index) {
    if (InboxFactory.checkValidPhoto(vm.photos[index])) {
      BroadcastFactory.reBroadcast(vm.photos[index]);
    } else {
      console.log('that photo is expired, refresh your inbox!');
    }
  }

  function saveToAlbum(index) {
    AlbumFactory.savePhoto(vm.photos[index]);
  }

  function getSrc(photoId){
    return "https://s3-us-west-1.amazonaws.com/ripple-photos/s3Upload/" + photoId + ".jpeg";
  }

}

angular
  .module('shout.inbox')
  .factory('InboxFactory', InboxFactory);

InboxFactory.$inject = ['$rootScope', '$http', '$localstorage', 'API_HOST'];

function InboxFactory($rootScope, $http, $localstorage, API_HOST) {
  console.log('InboxFactory');
  var services = {};
  services.photos = [];
  services.updateInbox = updateInbox;
  services.getPhotos = getPhotos;
  services.removeExpired = removeExpired;
  services.filterForNew = filterForNew;
  services.checkValidPhoto = checkValidPhoto;
  services.requestInbox = requestInbox; 


  return services;

  function updateInbox(data) {
    console.log('update inbox called');
    services.photos = data;
    $rootScope.$broadcast('updateInbox', services.photos);
  }

  function getPhotos(){
    return services.photos;
  }

  function removeExpired(oldInbox, newData){
    console.log('removeExpired called with oldInbox: ', oldInbox);
    var idArray = [];
    newData.forEach(function(item) {
      idArray.push(item.photoId);
    });
    console.log('removeExpired called!');
    var newInbox = _.filter(oldInbox, function(photo) {
      return _.contains(idArray, photo.photoId);
    });
    console.log('new inbox: ', newInbox);
    return newInbox;
  }

  function filterForNew(oldInbox, newData){
    var oldIdArray = [];
    console.log('filterForNew called with oldInbox: ', oldInbox);
    oldInbox.forEach(function(item) {
      oldIdArray.push(item.photoId);
    });
    console.log('oldIdArray: ', oldIdArray);
    var newPhotos = _.filter(newData, function(photo) {
      return !_.contains(oldIdArray, photo.photoId);
    });
    console.log('the new photos: ', newPhotos);
    return newPhotos;
  }

  function checkValidPhoto(photo){
    currIdArray = [];
    services.photos.forEach(function(item) {
      currIdArray.push(item.photoId);
    });
    return _.contains(currIdArray, photo.photoId);
  }

  function requestInbox() {
    var userId = $localstorage.get('userId');
    $http.get(API_HOST + '/users/inbox/' + userId)
         .success(function(data) {
          console.log('success getting inbox');
          services.updateInbox(data);
         })
         .error(function(){console.log('error getting inbox');});
  }

}


angular
  .module('shout.tabs')
  .controller('TabsCtrl', TabsCtrl);

TabsCtrl.$inject = ['$state', '$localstorage', 'CameraFactory'];

function TabsCtrl($state, $localstorage, CameraFactory){
  vm = this;
  vm.takePicture = takePicture;
  
  function takePicture() {
    CameraFactory.takePicture(function(imageURI) {
      $localstorage.set('imagePath', imageURI);
      $state.go('review'); 
    });
  }
}

angular
  .module('shout.localstorage')
  .factory('$localstorage', LocalStorageFactory);

LocalStorageFactory.$inject = ['$window'];

function LocalStorageFactory ($window) {
  var services = {};

  services.set = set;
  services.get = get;
  services.setObject = setObject;
  services.getObject = getObject;

  return services;

  function set(key, value) {
    $window.localStorage[key] = value;
  }

  function get(key, defaultValue) {
    return $window.localStorage[key] || defaultValue;
  }

  function setObject (key, value) {
      $window.localStorage[key] = JSON.stringify(value);
  }

  function getObject(key) {
      return JSON.parse($window.localStorage[key] || '{}');
  }

}

angular
  .module('shout.location')
  .factory('LocationFactory', LocationFactory);

LocationFactory.$inject = ['$ionicPlatform', '$http', 'InboxFactory', '$localstorage', 'API_HOST'];

function LocationFactory($ionicPlatform, $http, InboxFactory, $localstorage, API_HOST) {
  console.log('LocationFactory');
  var currentPosition, watchId, intervalId, userId;
  var services = {
    setPosition: setPosition,
    setWatch: setWatch,
    getCurrentPosition: getCurrentPosition,
    getSuccessCallback: getSuccessCallback,
    watchSuccessCallback: watchSuccessCallback,
    errorCallback: errorCallback,
    currentPosition: currentPosition,
    clearWatch: clearWatch,
    triggerPingInterval: triggerPingInterval,
    clearPingInterval: clearPingInterval,
    intervalId: intervalId,
    getUsersPosition: getUsersPosition
  };

  userId = $localstorage.get('userId');

  triggerPingInterval();

  return services;

  function getCurrentPosition(successCallback, errorCallback) {
    console.log('about to grab the initial position');
    navigator.geolocation.getCurrentPosition(successCallback, errorCallback);
  }

  function setWatch(successCallback, errorCallback) {
    console.log('setting watch on position');
    watchId = navigator.geolocation.watchPosition(successCallback, errorCallback);
  }

  function setPosition(position) {
    services.currentPosition = {
      userId: $localstorage.get('userId'),
      y: position.coords.latitude,
      x: position.coords.longitude,
      timestamp: new Date().getTime()
    };
    console.log(' currentPosition set! ', services.currentPosition);

  }

  function sendPosition() {
    if (services.currentPosition && services.currentPosition.userId && services.currentPosition.x && services.currentPosition.y) {
      $http.post(API_HOST + '/gps/position', services.currentPosition).success(function(data) {
        console.log('server got user position');
        InboxFactory.updateInbox(data);
      });
    } else {
      console.log('not sending incomplete position object to server');
    }
  }

  function errorCallback(error) {
    console.log('error getting position: ', error);
  }

  function getSuccessCallback(position) {
    setPosition(position);
    sendPosition();
  }

  function watchSuccessCallback(position) {
    setPosition(position);
  }

  function clearWatch() {
    navigator.geolocation.clearWatch(watchId);
  }

  function triggerPingInterval() {
    intervalId = setInterval(sendPosition, 60000);
  }

  function clearPingInterval() {
    console.log('clear ping interval called with id: ', intervalId);
    clearInterval(intervalId);
    intervalId = null;
  }

  function getUsersPosition(){
    return services.currentPosition;
  }

}

angular
  .module('shout.login')
  .controller('LoginCtrl', LoginCtrl);

LoginCtrl.$inject = ['$scope', '$state', 'LoginFactory'];

function LoginCtrl($scope, $state, LoginFactory) {
  console.log('LoginCtrl');
  var vm = this;
  vm.data = {};
  vm.data.username = 'mb';
  vm.data.email = 'm@b.com';
  vm.data.password = 'mb';

  vm.login = login;
  vm.badCombo = false;

  function login() {
    console.log('vm.data: ', vm.data);
    LoginFactory.loginUser(vm.data)
      .success(function(res) {
        console.log('res from server on login: ', res);
        LoginFactory.successfulLogin(res);
        $state.go('tab.inbox');
      })
      .error(function(res) {
        console.log('error on login');
        vm.badCombo = true;
      });
  }
}

angular
  .module('shout.login')
  .factory('LoginFactory', LoginFactory);

LoginFactory.$inject = ['LocationFactory', 'InboxFactory', '$localstorage', '$http', 'API_HOST'];

function LoginFactory(LocationFactory, InboxFactory, $localstorage, $http, API_HOST) {

  var services = {};
  services.successfulLogin = successfulLogin;
  services.loginUser = loginUser;

  return services;

  function loginUser(data) {
    return $http({
      method: 'POST',
      url: API_HOST + '/users/signin',
      data: data
    });
  }

  function successfulLogin(data) {
    console.log('successfulLogin');
    $localstorage.set('userId', data.userId);
    InboxFactory.updateInbox(data.inbox);
    LocationFactory.getCurrentPosition(LocationFactory.getSuccessCallback, LocationFactory.errorCallback);
    LocationFactory.setWatch(LocationFactory.watchSuccessCallback, LocationFactory.errorCallback);
  }

}

angular
  .module('shout.signup')
  .controller('SignupCtrl', SignupCtrl);

SignupCtrl.$inject = ['$state', 'SignupFactory'];

function SignupCtrl($state, SignupFactory) {
  console.log('SignupCtrl');
  var vm = this;
  vm.data = null;
  vm.badUsername = false;

  vm.signup = signup;

  function signup() {
    console.log('vm.data: ', vm.data);
    SignupFactory.signupUser(vm.data)
      .success(function(res) {
        console.log('response from server on singup: ', res);
        $state.go('login');
      })
      .error(function(res) {
        console.log('error on signup');
        vm.badUsername = true;
      });
  }

}

angular
  .module('shout.signup')
  .factory('SignupFactory', SignupFactory);

SignupFactory.$inject = ['$http', '$localstorage', 'API_HOST'];

function SignupFactory($http, $localstorage, API_HOST) {
  var services = {};
  services.signupUser = signupUser;

  return services;

  function signupUser(data) {
    console.log('signup data: ', data);
    return $http({
      method: 'POST',
      url: API_HOST + '/users/signup',
      data: data
    });
  }
}

angular
  .module('shout.review')
  .controller('ReviewCtrl', ReviewCtrl);

ReviewCtrl.$inject = ['$state', 'ReviewFactory', 'CameraFactory'];

function ReviewCtrl($state, ReviewFactory, CameraFactory) {
  console.log('ReviewCtrl');
  var vm = this;

  vm.photo = CameraFactory.filePath;
  vm.sharePhoto = sharePhoto;

  displayPhoto();

  function displayPhoto() {
    vm.photo = CameraFactory.filePath;
  }
  
  function sharePhoto(){
    $state.go('tab.settings');
  }
}

angular
  .module('shout.review')
  .factory('ReviewFactory', ReviewFactory);

ReviewFactory.$inject = ['$state'];

function ReviewFactory($state) {
  console.log('ReviewFactory');
  var services = {};

  services.photo = {};
  services.sharePhoto = sharePhoto;

  return services;

  function sharePhoto() {
    console.log('sharePhoto');
    $state.go('tab.settings');
  }

}

//angular
//  .module('s3UploadApp')
//  .config(s3configure)
//  .run(s3run);
//
//function s3configure($locationProvider) {
//  $locationProvider.html5Mode(true);
//}
//
//function s3run($rootScope, $location, $http) {
//  $http.get('/api/config').success(function(config) {
//    $rootScope.config = config;
//  });
//}

angular
  .module('s3Upload')
  .factory('s3', s3);

s3.$inject = ['$http', 'API_HOST'];

function s3($http, API_HOST) {

  var userId = 'userId';
  var url = 'https://' + 'ripple-photos' + '.s3.amazonaws.com/';
  var file = new File(); 

  var services = {};
  services.upload = upload;
  services.userId = userId;

  return services;

  function upload(newfile, callback) {
    file = newfile;
    console.log('uploadToS3');

    getSignedPolicy(function(response) {
      sendFile(response, function(){
        callback();
      });
    });
  }

  function getSignedPolicy(callback) {
    console.log('getSignedPolicy');
    $http.get(API_HOST + '/api/s3Policy?mimeType=' + file.type)
      .success(function(response) {
        callback(response);
      });
  }

  function sendFile(s3Params, callback) {
    console.log('sendFile');
    var extension = file.type.match(/\w+$/)[0];
    var params = {
      'key': 's3Upload/' + file.name + '.' + extension,
      'acl': 'public-read',
      'Content-Type': file.type,
      'AWSAccessKeyId': s3Params.AWSAccessKeyId,
      'success_action_status': '201',
      'Policy': s3Params.s3Policy,
      'Signature': s3Params.s3Signature
     };

    var options = new FileUploadOptions();
    options.fileKey = 'file';
    options.fileName = file.name + '.' + extension;
    options.mimeType = file.type;
    options.chunkedMode = false;
    options.params = params;
    console.log(options);
    var ft = new FileTransfer();
    ft.upload(file.localURL, url, callback, fail, options);
  }

  // Helper Functions
  function win(r) {
    console.log("Code = " + r.responseCode);
    console.log("Response = " + r.response);
    console.log("Sent = " + r.bytesSent);
  }

  function fail(error) {
    console.log("upload error source " + error.source);
    console.log("upload error target " + error.target);
    console.log(error);
  }

}

angular
  .module('shout.settings')
  .controller('SettingsCtrl', SettingsCtrl);

SettingsCtrl.$inject = ['$http', '$state', '$ionicHistory', 'SettingsFactory', '$localstorage', 'CameraFactory', 'LocationFactory', 's3', 'API_HOST'];

function SettingsCtrl($http, $state, $ionicHistory, SettingsFactory, $localstorage, CameraFactory, LocationFactory, s3, API_HOST) {
  console.log('SettingsCtrl');

  var vm = this;

  vm.radius = 5; //initial value 5 miles
  vm.TTL = 5; //initial value 5 minutes
  vm.watch = true;
  vm.acceptSettings = acceptSettings;
  vm.userSetWatch = userSetWatch;
  vm.sharePhoto = sharePhoto;

  function acceptSettings() {
    SettingsFactory.setSettings(parseInt(vm.radius), parseInt(vm.TTL));
    if ($ionicHistory.backView()) {
      $ionicHistory.goBack();
    } else {
      $state.go('tab.inbox');
    }
    console.log('radius set to: ', parseInt(vm.radius));
    console.log('TTL set to: ', parseInt(vm.TTL));
  }

  function sharePhoto() {
    console.log('SettingsCtrl.sharePhoto');
    CameraFactory.getFile(function(file) {
      file.name = $localstorage.get('userId') + Date.now();
      s3.upload(file, function() {
        $state.go('tab.inbox');
      });
    });
  }

  function userSetWatch() {
    SettingsFactory.setWatch(vm.watch);
  }

}

angular
  .module('shout.settings')
  .factory('SettingsFactory', SettingsFactory);

SettingsFactory.$inject = ['LocationFactory'];

function SettingsFactory(LocationFactory) {
  var radius = 5,
    TTL = 5; //initial values
  var services = {
    setSettings: setSettings,
    setWatch: setWatch,
    radius: radius,
    TTL: TTL
  };

  return services;

  function setWatch(watch) {
    console.log('settings factory set watch called with watch: ', watch);
    if (!watch) {
      LocationFactory.clearWatch();
      LocationFactory.clearPingInterval();
    } else {
      LocationFactory.getCurrentPosition(LocationFactory.getSuccessCallback, LocationFactory.errorCallback);
      LocationFactory.setWatch(LocationFactory.watchSuccessCallback, LocationFactory.errorCallback);
      LocationFactory.triggerPingInterval();
    }
  }

  function setSettings(userRadius, userTTL) {
    console.log('settings set in factory: ', TTL, radius);
    if (userRadius !== radius) {
      radius = userRadius;
    }
    if (userTTL !== TTL) {
      TTL = userTTL;
    }
  }

}
