#! /usr/bin/env node

require('scribe-js')(); //logging
var console = process.console;

var _ = require('underscore');

var Promise = require('bluebird');

var fs = require('fs');
Promise.promisifyAll(fs);

var path = require('path')

var program = require('commander');

var db = require('nano')('http://localhost:5984/fragments');

// Extract the tags from a fragment
// Tags are like #df #quote
// TODO: should ideally depend on the syntax of the file as tags should only be in the first comment
// 
// losely based on lines 106-7 of https://raw.github.com/bcherry/twitter-text-js/master/twitter-text.js
// 
var _tags_re = /(^|[^0-9A-Z&\/\?]+)(#|＃)([0-9A-Z_]*[A-Z_-]+[a-z0-9_]*)/gi;
var get_tags = function(text) {
  var tags = [];
  text.replace(_tags_re, function(match, before, hash, hashText) {
    tags.push(hashText);  
  });
  return tags;
}
// remove the tags from the text
var remove_tags = function(text) {
  return text.replace(_tags_re, '');
}

// Extract properties from a fragment
// properties are like p.33 key.lugo:1999_french
// 
var _props_re = /(^|[^0-9A-Z&\/\?]+)([0-9A-Z_]*[A-Z_-]+[a-z0-9_]*)(\.)([0-9A-Z_:-]+)/gi;
var get_props = function(text) {
  var props = {};
  text.replace(_props_re, function(match,before,key,dot,value){
    // console.log(key,' = ',value);
    props[key]=value;
  })
  // console.info('props = ',props);
  return props;
}
var remove_props = function(text) {
  return text.replace(_props_re, '');
}

// extract the id from a fragment.  The id is the first word (no spaces)
// 
var _id_re = /^[0-9A-Z&_-]+/i
var get_id = function(text) {
  var res = text.trim().match(_id_re);
  if( res && res.length && res.length > 0 ) {
    return res[0];
  }
  throw new Error("No id found for text = "+text);
  
}
var remove_id = function(text) {
  return text.trim().replace(_id_re, '').trim();
}


// text represents a fragment like:
//   joint_action #df \n whatever ...
// or:
//   event_cause #quote p.30 key.lugo:1990_french whatever ... \n whatever ...
var parse_fragment = function(text) {
  var tags = get_tags(text);
  var text = remove_tags(text);
  var props = get_props(text);
  var text = remove_props(text);
  var _id = get_id(text);
  var text = remove_id(text);
  var content = text;
  return {
    _id : _id,        // a unique label (e.g. joint_action)
    tags : tags,      // e.g. df, quote, etc
    props : props,    // e.g. {'p':30, 'key':'lugo:1990_french'}
    content : content // the main text of the fragment
  }
}

// Find all fragments in **text** and then
// convert them into fragment objects (with id, tags, props and content)
// then return the list of fragment objects.
// NB:can't deal with nested tags (TODO)
var _parse_ex = /§±([\s\S]*?)±§/gi;
var parse_text = function(text){
  var results = [];
  var m = _parse_ex.exec(text);
  while( m !== null ) {
    // console.log(m);
    var fragment_text = m[1];
    var fragment_object = parse_fragment(fragment_text);
    results.push(fragment_object);
    m = _parse_ex.exec(text);
  }
  return results;
}

// Gets the info about a file that we want to assocaite with fragments.
// Key features are: full path, filename, time modified
// 
var get_file_info = function( filename ) {
  var info = {};
  return new Promise(function(fulfill, reject){
    fs.realpathAsync(filename).then(function(the_path){
      info.path = path.dirname(the_path);
      info.basename = path.basename(the_path);
      info.ext = path.extname(the_path);
    }).then(function(){
      return fs.statAsync(filename);
    }).then(function(stats){
      info.modified = stats.ctime;
      fulfill(info);
    }).catch(reject);
  });
}

fragments = {}; // will be a module later
fragments.get_full_filename = function(fragment) {
  return path.join(fragment.source_file_info.path,fragment.source_file_info.basename);
};


// Read the text of a file and get the key info about it.
//
var get_file_info_and_text = function (filename) {
  return new Promise(function(fulfill, reject){
    fs.readFileAsync(filename, 'utf8')
      .then(function(text){
        get_file_info(filename)
          .then(function(info){
            return fulfill(info, text);
          });
      }).catch(reject);
  });
}


var save_fragment_to_db = function( fragment ) {
  db.get(fragment._id, function(err, body){
    var full_file_name = fragments.get_full_filename(fragment);
    if(err) {
      // the doc does not already exists
      
      // the main record in the db is like:
      //    { _id: 'whatever', fragments: {filename1:fragment1, filename2:fragment2} }
      var new_doc = {
        _id : fragment._id,
        fragments : {}
      };
      new_doc.fragments[full_file_name] = fragment;
      db.insert(new_doc);
    } else {
      // the doc does already exist
      var the_doc = body;
      // for now, we just overwrite
      body.fragments[full_file_name] = fragment;
      db.insert(body);
    }
  });
  
}

// reads **filename**, scans for fragments
// and adds those fragments to the database
var add_file = function (filename){
  console.log('add %s', filename);
  Promise.all([
    fs.readFileAsync(filename, 'utf8'),
    get_file_info(filename)
  ])
    .then(function(text_and_info){
      var text = text_and_info[0];
      var info = text_and_info[1];
      // console.info('--- file info');
      // console.info(info);
      // console.info('--- text');
      // console.info(text);
      var fragments = parse_text(text);
      // update the fragments with the file info
      fragments.forEach(function (fragment){
        fragment.source_file_info = info;
      });
      return fragments;
    })
    .then(function(fragments){
      //store fragments in database
      fragments.forEach(function(fragment){
        save_fragment_to_db(fragment);
        console.info('-- saved fragment');
        console.info(fragment);
      });
    });
};


var res = {
  _val : null,
  init : function() {res._val = null;},
  add : function(txt) {res._val += txt;},
  get : function(){return res._val;}
};


var get_all = function(){
  return new Promise(function(fulfill, reject){
    res.init();
    console.info('get-all');
    db.list({include_docs:true},function(err, body) {
      if (!err) {
        body.rows.forEach(function(doc) {
          res.add('\n\n#'+doc.id+'\n');
          _.mapObject(doc.doc.fragments, function(fragment,key){
            console.log('key ',key);
            res.add('##'+key+'\n');
            // TODO: tags, props, etc
            res.add(fragment.content);
          });
        });
        console.info(res.get());
        fulfill(res.get());
      } else {
        // error in db.list
        reject(err);
      }
    });
  });
};


program
  .version('0.1.0')
  .command('add <filename>')
  .description('read a file and add any fragments found to the database')
  .action(add_file);
  
program
  .command('get-all')
  .description('get all stored fragments')
  .action(get_all); //TODO: do something with the output (currently they're just logged)


program.parse(process.argv);