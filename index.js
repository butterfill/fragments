#! /usr/bin/env node

// When writing a variety of materials---lectures, handouts, papers, chapters, reviews---it is 
// common for various fragments to recur.  Recurring fragments include quotes, definitions
// and ideas.  Over time, a fragment may be refined in ways that are too subtle always to remember.
// And it is not always possible to remember in which file or files a given fragment occurs.
// For this reason it would sometimes useful to search for fragments via labels and tags.
// 
// This is a utility for capturing, storing and listing fragments
// of text from documents written using latex, jade or some other format.
// It is supposed to be used by (i) marking fragments in documents, (ii) calling `frg add <filename>` to
// extract and store fragements from a document, and then (iii) calling `frg get-all` to create
// a list of all fragments from all documents sorted by the fragments' ids.
// 
// An additional utility would read a document and show you which 
// fragments in it now have newer versions, putting the old and new versions side by side (TODO).
// This would make it quick to see whether a definition or quote needs correcting, say.
// 
// You could do all this with index cards; the aim of this utility is to get some of the benefits of
// index cards without breaking your flow by taking you out of the document you're writing.
// 
// A fragment might look like this:
//
// >   % §± ludwig_joint_action p.366 #quote key.ludwig_collective_2007
// >   ‘A \emph{joint action} is an event with two or more agents’ %, as  contrasted 
// >   with an \emph{individual   action} which is an event with a  single agent’
// >   % ±§
//
//
// Fragments are surrounded by the delimiters §± and ±§.
//  (TODO: allow custom delimiters)
// Fragments may be nested (TODO).
//
// The first line of a fragment is special.  It contains nothing other than
// the id, properties and tags.
//
// The fragment's id is the first word of the first line of a fragment after the opening delimiter.
// Fragments with the same id may occur in multiple documents, and will not necessarily be identical.
// (The point of collating fragments is to be able to quickly reuse and to compare.)
// The id should be easy enough to remember that you can guess the id when you want to reuse a fragment.
// 
// The properties associated with a fragment are often things like page numbers and bibtex keys.
// These are written like `p.336` and `key.ludwig_collective_2007`, i.e. `<key>.<value>`.
// You can create whatever properties you like.
//
//
// Tags can occur on the first line or anwhere in the fragment.  A tag is any word prefixed with #.
// 
// Everything from the opening delimiter to the closing delimiter, apart from the first line, is 
// the content of the fragment.
//
// To process a fragment it is useful to know whether it is written in latex, markdown, jade or 
// some other format.  Currently the format is inferred from the filename extension.  E.g. 'name.tex' is
// treated as latex, 'name.md' is treated as markdown.


// What follows is a terrible mish mash.
// I just wanted to get something working very quickly to see if it would be useful.


// scribe-js is a module for loging; it allows console.log({a:1}) to work.
require('scribe-js')();
// configure scribe-js
var console = process.console;

var _ = require('underscore');

var Promise = require('bluebird');

var fs = require('fs');
// promisifyAll(fs) creates fs.readFileAsync which returns a promise.
Promise.promisifyAll(fs);

var path = require('path')

// Commander is a module for creating shell scripts.
// It takes care of parsing commands and their arguments.
var program = require('commander');

// The nano module provides methods for working with couchdb.
// Here we use nano to connect to the fragments database directly.
var db = require('nano')('http://localhost:5984/fragments');

// pdc is an interface to pandoc.
// It will be useful for converting between different document formats.
var pdc = require('pdc'); 

// `get_tags` will extract the tags from a fragment.
// Tags are words proceeded by '#' as in `#df` `#quote` and `#joint-action`.
// 
// (This is losely based on lines 106-7 of https://raw.github.com/bcherry/twitter-text-js/master/twitter-text.js .)
// 
var _tags_re = /(^|[^0-9A-Z&\/\?]+)(#|＃)([0-9A-Z_]*[A-Z_-]+[a-z0-9_]*)/gi;
var get_tags = function(text) {
  var tags = [];
  text.replace(_tags_re, function(match, before, hash, hashText) {
    tags.push(hashText);  
  });
  return tags;
}
// Remove tags from the text.
var remove_tags = function(text) {
  return text.replace(_tags_re, '');
}

// `get_props` will extract properties from a fragment.
// Properties are things like `p.33` and `key.lugo:1999_french`.
// 
var _props_re = /(^|[^0-9A-Z&\/\?]+)([0-9A-Z_]*[A-Z_-]+[a-z0-9_]*)(\.)([0-9A-Z_:-]+)/gi;
var get_props = function(text) {
  var props = {};
  var firstline = text.split('\n')[0];
  firstline.replace(_props_re, function(match,before,key,dot,value){
    // console.log(key,' = ',value);
    props[key]=value;
  })
  // console.info('props = ',props);
  return props;
}
var remove_props = function(text) {
  return text.replace(_props_re, '');
}

// Extract the id from a fragment.  The id is the first word (no spaces).
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

// Remove the first line containing id, properties and tags from the fragment.
// This will not remove tags contained in the fragment proper.
// This works because the spec requires that the first line of a fragment contain 
// nothing other than id, properties and tags. 
var remove_id_props_tags = function(text) {
  // simply remove the first line
  return text.split('\n').splice(1).join('\n');
}

// Parsing a fragment means extracting: the id, tags, properties and 
// the content.
// 
// Text represents a fragment like:
// >  joint_action #df \n whatever ...
// or:
// >  event_cause #quote p.30 key.lugo:1990_french whatever ... \n whatever ...
var parse_fragment = function(text) {
  var tags = get_tags(text);
  //var text = remove_tags(text);
  var props = get_props(text);
  //var text = remove_props(text);
  var _id = get_id(text);
  //var text = remove_id(text);
  var text = remove_id_props_tags(text);
  var content = text;
  return {
    _id : _id,        // a unique label (e.g. joint_action)
    tags : tags,      // e.g. df, quote, etc
    props : props,    // e.g. {'p':30, 'key':'lugo:1990_french'}
    content : content // the main text of the fragment
  }
}

// Find all fragments in **text** and then
// convert them into fragment objects (with id, tags, props and content),
// then return the list of fragment objects.
//
// NB:can't yet deal with nested tags (TODO)
// What we really need is a super simple parser.
// There's a good clue about how to write one 
// [on stackexchange](http://stackoverflow.com/questions/14952113/how-can-i-match-nested-brackets-using-regex).
//
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


// fragments will eventually be a module (TODO).
// It will contain all the functions for processing individual fragments.
fragments = {}; 
// `get_full_filename` returns the filename (including path) of the document
// in which the fragemnt was found.
fragments.get_full_filename = function(fragment) {
  return path.join(fragment.source_file_info.path,fragment.source_file_info.basename);
};



var save_fragment_to_db = function( fragment ) {
  db.get(fragment._id, function(err, body){
    var full_file_name = fragments.get_full_filename(fragment);
    if(err) {
      // The doc does not already exists so we will create one.
      // The main record in the db is like:
      //    `{ _id: 'whatever', fragments: {filename1:fragment1, filename2:fragment2} }`.
      var new_doc = {
        _id : fragment._id,
        fragments : {}
      };
      new_doc.fragments[full_file_name] = fragment;
      db.insert(new_doc);
    } else {
      // The doc does already exist so we will update it if necessary.
      var the_doc = body;
      // For now, we just overwrite.
      // TODO: check whether `body.fragments[full_file_name]` exists; if so, has it changed? Only update if `fragment.content`, `fragment.props` or `fragment.tags` have changed.
      body.fragments[full_file_name] = fragment;
      db.insert(body);
    }
  });
  
}

// Read **filename**, scan for fragments,
// and add those fragments to the database.
// TODO: Mark any missing fragments as deleted from this document (delete missing fragments from the database).
var add_file = function (filename){
  console.log('add %s', filename);
  // Promise.all means do both and fulfill when both are done.
  // The `.then` function will be returned an array of the return values 
  // of the things promised (so `[file contents, file info]` in this case).
  Promise.all([
    fs.readFileAsync(filename, 'utf8'),
    get_file_info(filename)
  ])
    .then(function(text_and_info){
      var text = text_and_info[0];
      var info = text_and_info[1];
      // Parse the text, returning a list of fragments.
      var fragments = parse_text(text);
      // Update each fragment with the file info.
      fragments.forEach(function (fragment){
        fragment.source_file_info = info;
      });
      return fragments;
    })
    .then(function(fragments){
      //Store fragments in database.
      fragments.forEach(function(fragment){
        save_fragment_to_db(fragment);
        console.info('-- saved fragment');
        console.info(fragment);
      });
    });
};

// This object is for building a text file of all fragments.
// Right now it just adds strings.
// Later is should allow adding lines, headers and special things. (TODO).
// 
// Having `res` means you can easily alter how the fragments appear in the list.
//
var res = {
  _val : '',
  init : function() {res._val = '';},
  add : function(txt) {res._val += txt;},
  addFile : function(txt) {res._val += 'file: '+txt+'\n';},
  get : function(){return res._val;}
};

// Get all fragments and create a markdown document listing them.
// The document makes it easy to search for fragments by id or tag
// 
// TODO: convert fragments to markdown
// TODO: output a document (currently just logs to console).
// 
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
            //tags, props, date updated
            res.addFile(key);
            res.add('updated: '+fragment.source_file_info.modified+'\n');
            if( fragment.tags && fragment.tags.length && fragment.tags.length > 0 ) {
              res.add('tags: #'+fragment.tags.join(' #')+'\n');
            }
            _.mapObject(fragment.props, function(v,k){
              res.add(k+': '+v+'\n');
            });
            // the actual text of the fragment
            res.add(fragment.content);
            // TODO: convert to markdown
            // var content_md = pdc(fragment.content, 'latex', 'markdown', function(err, res){
            //   res.add(res.markdown);
            // })
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
  .action(get_all); 


program.parse(process.argv);