assert = require('chai').assert
parser = require('../parser')

FILE = 'exclude1 §± first ±§ exclude2 §± second-part1 §± third ±§ §± fourth §± fifth ±§ ±§ second-part2 ±§ exclude 3'


describe 'parser', ->
  describe 'parse', ->
    it 'should extract the fragment from a simple sting', ->
      assert.equal (x.trim() for x in (parser.parse "excluded §± included ±§ excluded "))[0], 'included'
    it 'should extract a fragment containing sub-fragments', ->
      assert.equal true, 'second-part1 §± third ±§ §± fourth §± fifth ±§ ±§ second-part2' in (x.trim() for x in (parser.parse FILE))
    it 'should extract sub-fragments', ->
      assert.equal true, 'third' in (x.trim() for x in (parser.parse FILE))
      