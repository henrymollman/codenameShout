function Quadtree(boundaries, maxChildren) {

  this.boundaries = boundaries || {x: -122.526000, y: 37.613500, width: 0.2, height: 0.2};
  this.maxChildren = maxChildren || 10;
  this.quadrants = [];
  this.children = [];

};

  // northwest point
    // 37.809455, -122.525293 

  // northeast point
    // 37.811552, -122.354177

  // southwest point
    // 37.613581, -122.510663

  // southeast point
    // 37.615192, -122.351613

  // insert function
  Quadtree.prototype.put = function (item) {

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
    if (this.children.length > this.maxChildren) {
        
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
      // find the correct quadrant
      var index = this.findIndex(item);

      // execute callback if it exists
      if (callback) {
        callback(this.quadrants[index].get(item));
      }

      // otherwise just return the array of coordinates
      else {
        return this.quadrants[index].get(item);
      }
    }

    // our quadtree does not have any quadrants
    else {
      // invoke callback if it is passed in
      if (callback) {
        callback(this.children);
      }
      // otherwise just return the children
      else {
        return this.children;
      }
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
      }
      else index = 0;
    }

    else {
      if (bottom) {
        index = 3;
      }
      else index = 1;
    }

    // return the quadrant index to getter function...
    return index;
  }

    Quadtree.prototype.update = function(item) {
      var results = this.get(item);
      var found;
      results.forEach(function(coord) {
        if (coord.username === item.username) {
          coord.x = item.x;
          coord.y = item.y;
          found = true;
        }
      });
      if (!found) {
        this.put(item);      
      }
    };


    // remove gps data function
      // find last position then delete according to id
    Quadtree.prototype.remove = function(item) {
      var results = this.get(item);
      item.x = +item.x;
      item.y = +item.y;
      for (var i = 0; i < results.length; i++) {
        if (results[i].x === item.x && results[i].y === item.y) {
          var removedItem = results.splice(i, 1);
        }
      }
      return removedItem;
    };

    // broadcast function 
      // use find then find others in same quadrant

    // subdivide quadrant when necessary
    Quadtree.prototype.subDivide = function() {
      var width = this.boundaries.width / 2;
      var height = this.boundaries.height / 2;
      var x = this.boundaries.x;
      var y = this.boundaries.y;

      // top left quadrant
      this.quadrants[0] = new Quadtree({
        x: x,
        y: y,
        width: width,
        height: height
      }, this.maxChildren);

      // top right quadrant
      this.quadrants[1] = new Quadtree({
        x: x + width,
        y: y,
        width: width,
        height: height
      }, this.maxChildren);   
      
      // bottom left quadrant
      this.quadrants[2] = new Quadtree({
        x: x,
        y: y + height,
        width: width,
        height: height
      }, this.maxChildren);   

      // bottom right quadrant
      this.quadrants[3] = new Quadtree({
        x: x + width,
        y: y + height,
        width: width,
        height: height
      }, this.maxChildren);
    };

    Quadtree.prototype.addData = function() {
      this.put({x: -122.515, y: 37.614, username: 'henry'});
      this.put({x: -122.408978, y: 37.783724, username: 'hackreactor'});
      this.put({x: -122.4184462, y: 37.7237467, username: 'taquerias el farolito'});
      this.put({x: -122.4832054, y: 37.7241541, username: 'sf zoo'});
      this.put({x: -122.4806091, y: 37.7828379, username: 'fire pits'});
      this.put({x: -122.3235064, y: 37.7141402, username: 'at&t park'});
      this.put({x: -122.3646192, y: 37.7032078, username: 'San+Bruno+Mountain+State+Park'});
      this.put({x: -122.4572735, y: 37.6769565, username: 'Holy+Cross+Cemetery'});
      this.put({x: -122.4158602, y: 37.7611788, username: 'Montgomery+St'});
      this.put({x: -122.416182, y: 37.7876884, username: 'Hopwater+Distribution'});
      this.put({x: -122.4275959, y: 37.6725777, username: 'Mussel+Rock+Park'});
      this.put({x: -122.4931705, y: 37.6754989, username: 'Brisbane+Community+Center'});
      this.put({x: -122.4074967, y: 37.7542639, username: 'greens restaurant'});
    };


    module.exports = new Quadtree();

    // combine quadrants when too few nodes

    /* 

    work in progress



    Quadtree.prototype.unfold = function() {
      debugger;
      if (!this.children.length) {
        if (this.quadrants.length && this.quadrants[0].children.length) {
          var children = this.quadrants.map(function(quadrant) {
            return quadrant.children;
          });
        }
      }
      this.quadrants = [];
      return children;
    }


    */